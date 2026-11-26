import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";

import {
  isSamePlaybackGeneration,
  type PlaybackGeneration,
} from "@/domain/playback/playback-generation";
import { emitPlayerKeyRequest } from "@/domain/playback/player-key-requests";
import type {
  PlaybackResult,
  PlaybackTimingMetadata,
  ShellMode,
  StreamInfo,
  SubtitleTrack,
  TitleInfo,
} from "@/domain/types";
import { scrubbedChildEnv } from "@/infra/os/child-env";
import { registerMpvProcess, terminateMpvProcess } from "@/infra/player/mpv-process-registry";
import { isSubtitleIpcCommand } from "@/infra/player/mpv-subtitle-tracks";
import {
  SubtitleFiles,
  prepareLaunchSubtitles,
  type SubtitleMediaRequest,
  resolvePlayerSubtitle,
} from "@/infra/player/subtitle-files";
import { copyShareLinkForContext } from "@/infra/share/copy-share-link";
import { removeMpvChaptersFile, writeMpvChaptersFile } from "@/infra/timing";
import { dbg } from "@/logger";
import { buildMpvArgs, shouldApplyStartAtSeek, writeMpvSensitiveConf } from "@/mpv";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { resolveTuning } from "@/services/persistence/tuning";
import {
  checkStremioPlaybackPreflight,
  checkStreamPreflight,
  isStremioPlayback,
} from "@/services/playback/stream-health-check";
import { MPV_IN_PROCESS_RECONNECT_MAX_ATTEMPTS } from "@kunai/config";

import { whichLive } from "../os/which";
import {
  buildKunaiBridgeScriptOptsArg,
  isEphemeralKunaiLuaScript,
  parseSkipPromptDurationMs,
  resolveKunaiMpvBridgeScriptPath,
} from "./kunai-mpv-bridge";
import { discoverMpvInvocation } from "./mpv-discovery";
import { probeMpvHdrCapability } from "./mpv-hdr";
import {
  computeInProcessReconnectSeek,
  isWatchdogReconnectTrigger,
  watchdogReconnectTrigger,
  type InProcessReconnectTrigger,
  type WatchdogReconnectTrigger,
} from "./mpv-in-process-reconnect";
import type { MpvIpcSession } from "./mpv-ipc";
import { openMpvIpcSession, waitForMpvIpcEndpoint } from "./mpv-ipc";
import {
  createMpvIpcEndpoint,
  ipcServerCliArg,
  mpvIpcBootstrapDiagnosticsHintSuffix,
  mpvIpcTransportTag,
  newMpvIpcSessionId,
  shouldUnlinkUnixSocket,
} from "./mpv-ipc-endpoint";
import { mpvIpcFailureEvents } from "./mpv-ipc-failure-events";
import { shouldEmitPlaybackProgress } from "./mpv-playback-kernel";
import { needsMpvNetworkPreflight } from "./mpv-playback-url";
import type { MpvUrlKind } from "./mpv-playback-url";
import type { MpvRuntimeOptions } from "./mpv-runtime-options";
import {
  applyEndFileEvent,
  createPlayerStatsState,
  finalizePlaybackResult,
  noteStreamStall,
  noteTrustedSeek,
  recordPlayerExit,
  type PlayerStatsState,
} from "./mpv-stats";
import { buildPersistentLoadfileCommand } from "./mpv-stream-http-headers";
import { PersistentMpvPropertyRouter } from "./persistent-mpv-property-router";
import type { PersistentMpvSessionRuntime } from "./persistent-mpv-runtime";
import { PersistentReadyWorkExecutor } from "./persistent-ready-work-executor";
import {
  resolveNearEofPrefetchTriggerSeconds,
  resolvePersistentStartSeekTarget,
  type PersistentResumeStartChoice,
} from "./persistent-ready-work-policy";
import { PersistentSubtitleManager } from "./persistent-subtitle-manager";
import {
  createPlaybackOutputDriver,
  readMpvVideoOutput,
  type PlaybackOutputDriver,
} from "./playback-output-gate";
import {
  type ActivePlaybackSkip,
  findActivePlaybackSkip,
  findPlaybackSegmentAtPosition,
  isPlaybackAutoSkipEnabled,
  playbackSkipKindLabel,
  type PlaybackSkipConfig,
  pruneSkippedPlaybackSegmentKeys,
} from "./playback-skip";
import { createPlaybackWatchdog, type PlaybackWatchdog } from "./playback-watchdog";
import { buildPlaybackStatsSnapshot } from "./PlaybackStatsSnapshot";
import type { ActivePlayerControl, MpvRequestedAction } from "./PlayerControlService";
import type { LateSubtitleAttachment, PlayerPlaybackEvent } from "./PlayerService";
import { extractExternalSubtitleIds } from "./subtitle-track-cache";

export { buildPersistentLoadfileCommand } from "./mpv-stream-http-headers";
export {
  extractExternalSubtitleIds,
  resolveNearEofPrefetchTriggerSeconds,
  resolvePersistentStartSeekTarget,
};

const IN_PROCESS_RECONNECT_BASE_BACKOFF_MS = 1_800;
const IN_PROCESS_RECONNECT_MAX_BACKOFF_MS = 16_000;

/**
 * Upper bound on a reconnect budget handed to `create` in a raw config object.
 * Well above the persisted cap (`MPV_IN_PROCESS_RECONNECT_MAX_ATTEMPTS`) so the
 * session harness can drive multi-attempt paths; nothing a user can configure
 * reaches it.
 */
const RECONNECT_ATTEMPT_CEILING = 12;

type MpvProcess = Pick<Bun.Subprocess, "exited" | "killed" | "exitCode" | "kill">;

const defaultPersistentMpvSessionRuntime: PersistentMpvSessionRuntime = {
  which: (command) => whichLive(command),
  spawn: (command, options) => Bun.spawn(command, options),
  waitForIpcEndpoint: waitForMpvIpcEndpoint,
  openIpcSession: openMpvIpcSession,
};

export type PlayerCycleOptions = {
  displayTitle: string;
  urlKind?: MpvUrlKind;
  subtitleUrlKind?: MpvUrlKind;
  subtitleMedia?: SubtitleMediaRequest;
  audioPreference?: string;
  subtitlePreference?: string;
  primarySubtitle: string | null;
  subtitleTracks?: readonly SubtitleTrack[];
  startAt?: number;
  /** Optional resume offer shown in mpv without automatically seeking. */
  resumePromptAt?: number;
  /** When true, mpv shows resume vs start-over before a manual resume seek. */
  offerResumeStartChoice?: boolean;
  /** Human-readable offset for the prompt (e.g. "12:34"). */
  resumeChoiceTimeLabel?: string;
  timing?: PlaybackTimingMetadata | null;
  autoSkipEnabled?: boolean;
  skipRecap?: boolean;
  skipIntro?: boolean;
  skipPreview?: boolean;
  skipCredits?: boolean;
  autoNextEnabled?: boolean;
  onPlayerReady?: () => void;
  onPlaybackEvent?: (event: PlayerPlaybackEvent) => void;
  /** Aborts addon preflight waits before the file is handed to mpv. */
  abortSignal?: AbortSignal;
  /** Called when the user presses N or P inside the mpv window. The mpv process
   *  handles the stop itself; the app only needs to record the intent. */
  onMpvActionRequest?: (action: MpvRequestedAction) => void;
  /** Called once when playback reaches the credits prefetch window or the final ~30 s fallback. */
  onNearEof?: () => void;
  shareLinkContext?: {
    readonly mode: ShellMode;
    readonly title: Pick<TitleInfo, "id" | "type" | "name" | "externalIds" | "isAnime">;
    readonly episode?: { readonly season: number; readonly episode: number };
    readonly providerId?: string;
    readonly onCopied?: (result: { readonly url: string; readonly copied: boolean } | null) => void;
  };
};

type PlayerCycleState = {
  stats: PlayerStatsState;
  resolve: (result: PlaybackResult) => void;
  promise: Promise<PlaybackResult>;
  playerReadyNotified: boolean;
  output: PlaybackOutputDriver;
  lastPlaybackProgressEventAtMs: number;
  lastPlaybackProgressPositionSeconds: number;
  lastPlaybackProgressDurationSeconds: number;
  acceptPlaybackProperties: boolean;
  onPlayerReady?: () => void;
  onPlaybackEvent?: (event: PlayerPlaybackEvent) => void;
};

export class PersistentMpvSession {
  private static readonly readyWorkFallbackMs = 750;
  private static readonly loadfileReadyWorkFallbackMs = 12_000;
  private readonly id = newMpvIpcSessionId();
  private readonly ipcEndpoint = createMpvIpcEndpoint(this.id);
  private luaScriptPath: string | null = null;
  private mpv: MpvProcess | null = null;
  private mpvUnregister: (() => void) | null = null;
  private ipcSession: MpvIpcSession | null = null;
  private activeCycle: PlayerCycleState | null = null;
  /**
   * Set synchronously by close()/termination, before any await. Bootstrap work
   * that was already in flight for the outgoing process checks this after each
   * await, so a late endpoint wait or IPC open cannot install a resource,
   * publish an event, or activate player control on a retired session.
   */
  private retired = false;
  private ownedSubtitleFiles: SubtitleFiles | undefined;
  private subtitleFiles(): SubtitleFiles {
    return (this.ownedSubtitleFiles ??= new SubtitleFiles(
      this.runtime.downloadSubtitle,
      isStremioPlayback(this.playbackStream)
        ? undefined
        : (this.currentOptions.subtitleMedia ?? this.playbackStream),
    ));
  }
  private readonly subtitleManager = new PersistentSubtitleManager(
    () => this.currentOptions.subtitlePreference?.trim().toLowerCase() !== "none",
    (url, kind) =>
      resolvePlayerSubtitle(
        url,
        kind,
        this.retired ? undefined : this.subtitleFiles(),
        this.currentCycleOptions().abortSignal,
      ),
  );
  private readonly propertyRouter = new PersistentMpvPropertyRouter({
    getActiveCycle: () => this.activeCycle,
    getIpcSession: () => this.ipcSession,
    getCurrentOptions: () => this.currentCycleOptions(),
    subtitleManager: this.subtitleManager,
    notifyMpvActionRequest: (action) => this.currentCycleOptions().onMpvActionRequest?.(action),
    finishResumeChoiceWait: (choice) => {
      if (this.resumeChoiceWait) {
        this.finishResumeChoiceWait(choice);
      }
    },
    handleResumeSeekFromMpv: async () => this.handleResumeSeekFromMpv(),
    handleCopyShareFromMpv: async () => this.handleCopyShareFromMpv(),
    notifyMpvKeyRequest: emitPlayerKeyRequest,
    onSkipRequestFromMpv: async (automatic) => this.onSkipRequestFromMpv(automatic),
    getCurrentPositionSeconds: () => this.currentPositionSeconds,
    setCurrentPositionSeconds: (value) => {
      this.currentPositionSeconds = value;
    },
    maybeRearmSkippedSegmentsOnBackwardSeek: (options, previous, next) => {
      this.maybeRearmSkippedSegmentsOnBackwardSeek(options, previous, next);
    },
    maybeEmitPlaybackProgress: (cycle, observedAt) => {
      this.maybeEmitPlaybackProgress(cycle as PlayerCycleState, observedAt);
    },
    handleSegmentSkipProgress: async (options) => this.handleSegmentSkipProgress(options),
    fireNearEofIfNeeded: (positionSeconds) => this.fireNearEofIfNeeded(positionSeconds),
    observeWatchdog: (sample) => this.watchdog?.observe(sample),
  });
  private alive = false;
  private currentControl: ActivePlayerControl;
  private hasLoadedFile = false;
  /**
   * Deferred sensitive-conf cleanup. In a persistent session `--include` rides
   * inside the initial file's `--{ ... --}` group and mpv reads it lazily at
   * file-entry processing, so deleting it at IPC-ready would silently drop the
   * sensitive options. Released at the first file-loaded/end-file (the include
   * is consumed by then) or on process termination.
   */
  private initialConfCleanup: (() => Promise<void>) | null = null;
  private currentPositionSeconds = 0;
  private skippedSegments = new Set<string>();
  private currentOptions: PlayerCycleOptions;
  private watchdog: PlaybackWatchdog | null = null;
  /**
   * One playback cycle inside this process. Every deferred continuation captures
   * it and rechecks before mutating, so a replacement cycle cannot be driven by
   * the previous cycle's file load, ready work, or reconnect.
   */
  private cycleGeneration: PlaybackGeneration = { process: 1, cycle: 0 };
  /**
   * The single outstanding `loadfile`. mpv's `file-loaded` carries no identity,
   * so at most one owner may exist: a replacement retires the previous owner
   * before issuing its own load, and an unowned `file-loaded` is ignored.
   */
  private pendingFileLoad: { readonly id: number; readonly generation: PlaybackGeneration } | null =
    null;
  private nextFileLoadId = 1;
  /** The generation whose file is actually loaded; property/end-file routing uses this. */
  private loadedFileGeneration: PlaybackGeneration | null = null;
  private pendingReadyWork: {
    readonly options: PlayerCycleOptions;
    readonly generation: PlaybackGeneration;
  } | null = null;
  private readyWorkFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private terminationPromise: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  private terminated = false;
  private lastSkipTo = -1;
  private nearEofFired = false;
  /** Segment key for the active mpv skip prompt (Lua overlay + delayed auto-skip). */
  private skipPromptSegmentKey: string | null = null;
  private skipAutoTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped whenever skip user-data changes so mpv Lua resets its 3s prompt timer. */
  private skipUserDataRev = 0;
  /** Suppress segment OSD/skip until initial resume seek has run (avoids time-pos@0 races). */
  private resumeSeekPending = false;
  /** Position the current file was loaded at (0 or resume seconds). Null if not yet tracked. */
  private loadStartAt: number | null = null;
  /** True when spawn() baked --sub-file into mpv argv (first play only). */
  private subtitlesAttachedAtSpawn = false;
  /** True when spawn() baked --force-media-title into mpv argv (first play only). */
  private titleAppliedViaArgs = false;
  private scriptOptsArg: string | undefined;
  /** Bun delayed auto-skip timer; must match Lua chip countdown (`user-data/kunai-skip-prompt-ms`). */
  private skipPromptDurationMs = 3000;

  private static readonly resumeChoiceTimeoutMs = 12_000;
  private resumeChoiceTimeoutMs = PersistentMpvSession.resumeChoiceTimeoutMs;

  private resumeChoiceWait: {
    resolve: (choice: PersistentResumeStartChoice) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  } | null = null;

  private playbackStream: StreamInfo;
  private mpvInProcessStreamReconnectEnabled = true;
  private mpvInProcessStreamReconnectMaxAttempts = 1;
  private reconnectBaseBackoffMs = IN_PROCESS_RECONNECT_BASE_BACKOFF_MS;
  private reconnectMaxBackoffMs = IN_PROCESS_RECONNECT_MAX_BACKOFF_MS;
  private reconnectTryCount = 0;
  private reconnectBackoffUntilMs = 0;
  private reconnectInFlight = false;
  private pendingInProcessReconnect: {
    seekSeconds: number;
    shouldSeek: boolean;
    trigger: InProcessReconnectTrigger;
    generation: PlaybackGeneration;
  } | null = null;

  private constructor(
    private readonly initialStream: StreamInfo,
    private readonly initialOptions: PlayerCycleOptions,
    private readonly onControlReady: (control: ActivePlayerControl | null) => void,
    private readonly runtime: PersistentMpvSessionRuntime,
  ) {
    this.playbackStream = initialStream;
    this.currentOptions = initialOptions;
    this.currentControl = {
      id: this.id,
      stop: async () => {
        if (this.ipcSession) {
          const result = await this.ipcSession.send(["quit"], 1_000);
          if (result.ok) return;
        }
        this.mpv?.kill("SIGTERM");
      },
      stopCurrentFile: async () => {
        if (!this.ipcSession) {
          this.mpv?.kill("SIGTERM");
          return;
        }
        const result = await this.ipcSession.send(["stop"], 1_000);
        if (!result.ok) this.mpv?.kill("SIGTERM");
      },
      reloadSubtitles: async () => {
        await this.reloadSubtitles();
      },
      selectSubtitle: async (selection) => await this.selectSubtitle(selection),
      attachSubtitles: async (attachment) => await this.attachSubtitles(attachment),
      skipCurrentSegment: async () => this.skipCurrentSegment(),
      updateTiming: (timing) => this.updateTiming(timing),
      updateAutoSkipEnabled: (enabled) => this.updateAutoSkipEnabled(enabled),
      getStatsSnapshot: () =>
        this.activeCycle ? buildPlaybackStatsSnapshot(this.activeCycle.stats) : null,
      showOsdMessage: async (text, durationMs) => {
        await this.ipcSession?.send(["show-text", text, durationMs], 1_000);
      },
      setEpisodeTransitionLoading: async (message) => {
        await this.ipcSession?.send(
          ["set_property", "user-data/kunai-loading", message ?? ""],
          1_000,
        );
      },
      setEpisodeNavigationAvailability: async (state) => {
        if (!this.ipcSession) return;
        await Promise.all([
          this.ipcSession.send(["set_property", "user-data/kunai-can-next", state.hasNext], 1_000),
          this.ipcSession.send(
            ["set_property", "user-data/kunai-can-previous", state.hasPrevious],
            1_000,
          ),
          this.ipcSession.send(
            ["set_property", "user-data/kunai-next-label", state.nextLabel ?? ""],
            1_000,
          ),
          this.ipcSession.send(
            ["set_property", "user-data/kunai-previous-label", state.previousLabel ?? ""],
            1_000,
          ),
          this.ipcSession.send(
            ["set_property", "user-data/kunai-next-unavailable", state.nextUnavailableReason ?? ""],
            1_000,
          ),
          this.ipcSession.send(
            [
              "set_property",
              "user-data/kunai-previous-unavailable",
              state.previousUnavailableReason ?? "",
            ],
            1_000,
          ),
        ]);
      },
    };
  }

  static async create(opts: {
    stream: StreamInfo;
    options: PlayerCycleOptions;
    mpv?: MpvRuntimeOptions;
    kitsuneConfig: KitsuneConfig;
    onControlReady: (control: ActivePlayerControl | null) => void;
    /** Test seam for deterministic fake mpv IPC. Production uses Bun/mpv directly. */
    runtime?: PersistentMpvSessionRuntime;
    /** Test seam for the mpv resume prompt timeout; production uses the default 12s. */
    resumeChoiceTimeoutMs?: number;
  }): Promise<PersistentMpvSession> {
    const session = new PersistentMpvSession(
      opts.stream,
      opts.options,
      opts.onControlReady,
      opts.runtime ?? defaultPersistentMpvSessionRuntime,
    );
    const cfg = opts.kitsuneConfig;
    session.mpvInProcessStreamReconnectEnabled = cfg.mpvInProcessStreamReconnect !== false;
    const maxAttempts = cfg.mpvInProcessStreamReconnectMaxAttempts;
    // The fallback is the shipped default, not a number of its own. It read 3
    // while the default has been 1 and `ConfigServiceImpl` has capped persisted
    // values at 1 — so a config that reached here without the key got a budget
    // the CLI does not offer anywhere in its UI.
    //
    // `RECONNECT_ATTEMPT_CEILING` stays above that cap on purpose: it bounds a
    // raw config object handed straight to this factory (compiled smoke, the
    // session harness), which never passes through the persisted clamp. It is a
    // structural guard against a nonsense value, not the user-facing policy.
    session.mpvInProcessStreamReconnectMaxAttempts =
      typeof maxAttempts === "number" && Number.isFinite(maxAttempts)
        ? Math.max(0, Math.min(RECONNECT_ATTEMPT_CEILING, Math.trunc(maxAttempts)))
        : MPV_IN_PROCESS_RECONNECT_MAX_ATTEMPTS;
    const tuning = resolveTuning(cfg.tuningOverrides);
    session.reconnectBaseBackoffMs = tuning.mpvReconnectBaseBackoffMs;
    session.reconnectMaxBackoffMs = tuning.mpvReconnectMaxBackoffMs;
    if (
      typeof opts.resumeChoiceTimeoutMs === "number" &&
      Number.isFinite(opts.resumeChoiceTimeoutMs)
    ) {
      session.resumeChoiceTimeoutMs = Math.max(1, Math.trunc(opts.resumeChoiceTimeoutMs));
    }
    session.skipPromptDurationMs = parseSkipPromptDurationMs(cfg.mpvKunaiScriptOpts);
    session.scriptOptsArg = buildKunaiBridgeScriptOptsArg(cfg.mpvKunaiScriptOpts);
    session.luaScriptPath = await resolveKunaiMpvBridgeScriptPath(cfg);
    try {
      await session.spawn(opts.mpv);
    } catch (error) {
      // A failed startup must not strand localized subtitle files or the
      // sensitive conf (args/prep/spawn errors happen before mpv could read it).
      await session.releaseInitialConf();
      await session.ownedSubtitleFiles?.close().catch(() => {});
      session.ownedSubtitleFiles = undefined;
      throw error;
    }
    return session;
  }

  async play(stream: StreamInfo, options: PlayerCycleOptions): Promise<PlaybackResult> {
    if (!this.alive || !this.mpv) {
      throw new Error("Persistent MPV session is not alive");
    }

    if (this.activeCycle) {
      throw new Error("Persistent MPV session is already playing");
    }

    this.playbackStream = stream;
    const cycle = this.beginCycle(options, { acceptPlaybackProperties: false });
    this.resetCycleState();
    options.onPlaybackEvent?.({ type: "opening-stream" });

    if (!this.hasLoadedFile) {
      this.hasLoadedFile = true;
      this.queueReadyWork(options);
      return await cycle.promise;
    }

    // Replacement admission: retire the previous owner, then install exactly one.
    const generation = this.advanceCycleGeneration();
    const fileLoadId = this.installPendingFileLoad(generation);

    const oldScope = this.ownedSubtitleFiles;
    this.ownedSubtitleFiles = undefined;
    await this.subtitleManager.removeExternalSubtitles(this.ipcSession).finally(() => {
      void oldScope?.close();
    });
    options.onPlaybackEvent?.({ type: "resolving-playback" });
    this.queueReadyWork(options, { armFallback: false });

    this.loadStartAt = shouldApplyStartAtSeek(options.startAt) ? (options.startAt ?? 0) : 0;

    const addon = isStremioPlayback(stream);
    const preflightPromise =
      !addon && needsMpvNetworkPreflight(stream.url, options.urlKind)
        ? checkStreamPreflight(stream.url, stream.headers, undefined, {
            cachedAt: stream.timestamp,
            streamReachabilityVerified: stream.providerResolveResult?.streamReachabilityVerified,
            requiresYtdl: stream.requiresYtdl,
          })
        : Promise.resolve({ status: "reachable" as const });

    if (options.timing) {
      try {
        const oldChapters = this.currentChaptersFilePath;
        this.currentChaptersFilePath = await writeMpvChaptersFile(
          options.timing,
          `${this.id}-${this.cycleGeneration.cycle}`,
        );
        if (oldChapters && oldChapters !== this.currentChaptersFilePath) {
          void removeMpvChaptersFile(oldChapters);
        }
      } catch {
        // Best effort chapters file
      }
    } else if (this.currentChaptersFilePath) {
      const oldChapters = this.currentChaptersFilePath;
      this.currentChaptersFilePath = null;
      void removeMpvChaptersFile(oldChapters);
    }

    // Addon files are verified one request at a time: the strict preflight
    // must pass — and the cycle must still be current — before a loadfile is
    // ever written to the wire.
    const addonPreflight = addon
      ? await (this.runtime.checkAddonPreflight ?? checkStremioPlaybackPreflight)(
          stream,
          options.abortSignal,
        )
      : undefined;
    // A result that arrived after this cycle was retired belongs to a dead
    // owner: touching pending-load bookkeeping now would clear the NEW owner.
    if (addon && (!this.isGenerationCurrent(generation) || this.activeCycle !== cycle)) {
      return await cycle.promise;
    }
    const addonRefused =
      addonPreflight !== undefined &&
      (addonPreflight.status !== "reachable" || options.abortSignal?.aborted);
    const loadResult = addonRefused
      ? undefined
      : await this.ipcSession?.send(
          buildPersistentLoadfileCommand(
            stream.url,
            stream.isLive ? undefined : options.startAt,
            stream.headers,
            {
              requiresYtdl: stream.requiresYtdl,
              ytdlFormat: stream.ytdlFormat,
              ytdlRawOptions: stream.ytdlRawOptions,
              isLive: stream.isLive,
              urlKind: options.urlKind,
              audioPreference: options.audioPreference,
              subtitlePreference: options.subtitlePreference,
              chaptersFile: this.currentChaptersFilePath,
              stremioAddon: addon,
            },
          ),
          3_000,
        );

    const preflight = await preflightPromise;
    if (
      addonRefused ||
      (preflight.status === "unreachable" && preflight.definitive && !loadResult?.ok)
    ) {
      const error = addonRefused
        ? `addon stream refused: ${
            addonPreflight.status === "unreachable"
              ? addonPreflight.reason
              : addonPreflight.status === "reachable"
                ? "playback superseded"
                : addonPreflight.status
          }`
        : `stream unreachable: ${preflight.status === "unreachable" ? preflight.reason : ""}`;
      void this.ipcSession?.send(["set_property", "user-data/kunai-loading", ""], 500);
      options.onPlaybackEvent?.({
        type: "ipc-command-failed",
        command: "loadfile",
        error,
      });
      this.clearPendingFileLoadIf(fileLoadId, generation);
      cycle.stats.endReason = "error";
      this.activeCycle = null;
      cycle.resolve({
        watchedSeconds: 0,
        duration: 0,
        endReason: "error",
        resultSource: "ipc",
        playerExitedCleanly: true,
        playerExitCode: 0,
        playerExitSignal: null,
        socketPathCleanedUp: false,
        lastNonZeroPositionSeconds: 0,
        lastNonZeroDurationSeconds: 0,
        lastTrustedProgressSeconds: 0,
        lastReliableProgressSeconds: 0,
      });
      return await cycle.promise;
    }

    if (!loadResult?.ok) {
      // Compare id and generation so an older rejection cannot erase a newer owner.
      this.clearPendingFileLoadIf(fileLoadId, generation);
      void this.ipcSession?.send(["set_property", "user-data/kunai-loading", ""], 500);
      options.onPlaybackEvent?.({
        type: "ipc-command-failed",
        command: "loadfile",
        error: loadResult?.error ?? "ipc unavailable",
      });
    }
    this.armReadyWorkFallback(options, PersistentMpvSession.loadfileReadyWorkFallbackMs);
    return await cycle.promise;
  }

  isAlive(): boolean {
    return this.alive;
  }

  isReusable(): boolean {
    return this.alive && this.mpv !== null && this.ipcSession !== null;
  }

  getControl(): ActivePlayerControl {
    return this.currentControl;
  }

  updateTiming(timing: PlaybackTimingMetadata | null): void {
    if (!this.activeCycle) return;
    this.currentOptions = { ...this.currentOptions, timing };
    void this.handleSegmentSkipProgress(this.currentOptions);
    void this.syncMpvChaptersFile(timing);
  }

  updateAutoSkipEnabled(enabled: boolean): void {
    if (!this.activeCycle) return;
    this.currentOptions = { ...this.currentOptions, autoSkipEnabled: enabled };
    this.clearSkipPromptState();
    void this.handleSegmentSkipProgress(this.currentOptions);
  }

  waitForCurrentPlayback(): Promise<PlaybackResult> {
    if (!this.activeCycle) {
      throw new Error("Persistent MPV session has no active playback");
    }
    return this.activeCycle.promise;
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.performClose();
    return this.closePromise;
  }

  private async performClose(): Promise<void> {
    this.currentCycleOptions().onPlaybackEvent?.({ type: "player-closing" });
    this.clearReadyWorkFallback();
    this.pendingReadyWork = null;
    this.alive = false;
    this.retired = true;
    this.retirePendingFileLoad();
    this.loadedFileGeneration = null;

    if (this.currentChaptersFilePath) {
      const path = this.currentChaptersFilePath;
      this.currentChaptersFilePath = null;
      void removeMpvChaptersFile(path);
    }

    const target = this.mpv;

    if (this.ipcSession) {
      this.abortResumeChoiceWaitForCycleEnd();
      void this.ipcSession.send(["set_property", "user-data/kunai-loading", ""], 400);
      const result = await this.ipcSession.send(["quit"], 500);
      if (!result.ok) {
        target?.kill("SIGTERM");
      }
    } else {
      target?.kill("SIGTERM");
    }

    let closed = await this.waitForProcessClose(target, 800);
    if (!closed) {
      target?.kill("SIGTERM");
      closed = await this.waitForProcessClose(target, 800);
    }
    if (!closed) {
      target?.kill("SIGKILL");
      closed = await this.waitForProcessClose(target, 500);
    }

    await this.handleProcessTermination({
      code: target?.exitCode ?? (closed ? 0 : null),
      signal: target?.killed
        ? ("SIGTERM" as NodeJS.Signals)
        : closed
          ? null
          : ("SIGKILL" as NodeJS.Signals),
    });
  }

  private async spawn(mpvOptions?: MpvRuntimeOptions): Promise<void> {
    if (shouldUnlinkUnixSocket(this.ipcEndpoint)) {
      await unlinkIfExists(this.ipcEndpoint.path);
    }

    this.terminationPromise = null;
    this.terminated = false;
    this.beginCycle(this.initialOptions);
    this.initialOptions.onPlaybackEvent?.({ type: "launching-player" });

    const includeStartArg = shouldApplyStartAtSeek(this.initialOptions.startAt);
    // Persistent replacements always pass a file-local loadfile `start` option
    // (`0` for normal navigation, resume seconds for direct continue). That
    // clears any process-level --start used for the initial file.
    if (this.initialOptions.timing) {
      try {
        this.currentChaptersFilePath = await writeMpvChaptersFile(
          this.initialOptions.timing,
          `${this.id}-${Date.now()}`,
        );
      } catch {
        // Best effort chapters file
      }
    }

    const sensitiveConf = await writeMpvSensitiveConf(
      {
        url: this.initialStream.url,
        headers: this.initialStream.headers ?? {},
        requiresYtdl: this.initialStream.requiresYtdl,
        ytdlRawOptions: this.initialStream.ytdlRawOptions,
      },
      this.ipcEndpoint,
    );
    // Registered before any handler can fire: a persistent session scopes
    // `--include` inside the initial file's `--{ ... --}` group and mpv reads
    // it lazily at file-entry processing, so deletion must wait for
    // file-loaded/end-file or process exit — `releaseInitialConf` covers all
    // three, and create()'s catch covers errors before spawn.
    this.initialConfCleanup = sensitiveConf?.cleanup ?? null;
    // Only an explicit HDR mode emits gpu-next options; `auto` leaves mpv alone.
    const needsHdrProbe =
      mpvOptions?.supportsGpuNext === undefined &&
      this.runtime.spawn === defaultPersistentMpvSessionRuntime.spawn &&
      mpvOptions?.hdrMode !== undefined &&
      mpvOptions.hdrMode !== "auto";
    const mpvProbeInvocation = needsHdrProbe
      ? discoverMpvInvocation({
          which: this.runtime.which,
          ...(this.runtime.exists && { exists: this.runtime.exists }),
        })
      : null;
    const hdrCapability = mpvProbeInvocation
      ? await probeMpvHdrCapability(mpvProbeInvocation)
      : null;
    const effectiveMpvOptions: MpvRuntimeOptions | undefined =
      hdrCapability !== null
        ? { ...mpvOptions, supportsGpuNext: hdrCapability.supportsGpuNext }
        : mpvOptions;
    const launchSubs = await prepareLaunchSubtitles(
      { ...this.initialOptions, subtitle: this.initialOptions.primarySubtitle },
      this.subtitleFiles(),
    );
    if (this.initialOptions.abortSignal?.aborted || this.retired) {
      return this.handleProcessTermination({ code: 1, signal: null });
    }
    const args = buildMpvArgs(
      {
        url: this.initialStream.url,
        urlKind: this.initialOptions.urlKind,
        headers: this.initialStream.headers ?? {},
        audioPreference: this.initialOptions.audioPreference,
        subtitlePreference: this.initialOptions.subtitlePreference,
        ...launchSubs,
        displayTitle: this.initialOptions.displayTitle,
        startAt: this.initialStream.isLive ? undefined : this.initialOptions.startAt,
        isLive: this.initialStream.isLive,
        requiresYtdl: this.initialStream.requiresYtdl,
        ytdlFormat: this.initialStream.ytdlFormat,
        ytdlRawOptions: this.initialStream.ytdlRawOptions,
        stremioAddon: isStremioPlayback(this.initialStream),
        chaptersFile: this.currentChaptersFilePath,
      },
      ipcServerCliArg(this.ipcEndpoint),
      {
        persistent: true,
        mpv: effectiveMpvOptions,
        includeStartArg,
        scriptPath: this.luaScriptPath ?? undefined,
        scriptOpts: this.scriptOptsArg,
        sensitiveOptionsPath: sensitiveConf?.path,
      },
    );
    this.loadStartAt =
      includeStartArg && this.initialOptions.startAt ? this.initialOptions.startAt : 0;
    this.subtitlesAttachedAtSpawn = Boolean(launchSubs.subtitle);
    this.titleAppliedViaArgs = true;

    await this.spawnProcessAndConnect(mpvOptions, args);
  }

  /** The spawn→IPC-connect tail of {@link spawn}. */
  private async spawnProcessAndConnect(
    mpvOptions: MpvRuntimeOptions | undefined,
    args: string[],
  ): Promise<void> {
    const emitPlaybackEvent = (event: PlayerPlaybackEvent) => {
      const active = this.activeCycle;
      if (active && (event.type === "stream-stalled" || event.type === "ipc-stalled")) {
        noteStreamStall(active.stats, Date.now());
      }
      this.currentCycleOptions().onPlaybackEvent?.(event);
      // handleWatchdogReconnect checks that in-process reconnect is enabled.
      const reconnectTrigger = watchdogReconnectTrigger(event);
      if (reconnectTrigger) void this.handleWatchdogReconnect(reconnectTrigger);
    };
    this.watchdog = (this.runtime.createPlaybackWatchdog ?? createPlaybackWatchdog)(
      emitPlaybackEvent,
    );

    const mpvInvocation = discoverMpvInvocation({
      which: this.runtime.which,
      ...(this.runtime.exists && { exists: this.runtime.exists }),
    });
    if (!mpvInvocation) {
      this.currentCycleOptions().onPlaybackEvent?.({
        type: "ipc-command-failed",
        command: "spawn",
        error: "mpv is not installed or not found on PATH",
      });
      await this.handleProcessTermination({ code: 1, signal: null });
      return;
    }

    // The initial addon file goes on argv, so refusal must precede spawn —
    // there is no loadfile interception point for the first file.
    if (isStremioPlayback(this.initialStream)) {
      const preflight = await (this.runtime.checkAddonPreflight ?? checkStremioPlaybackPreflight)(
        this.initialStream,
        this.initialOptions.abortSignal,
      );
      if (preflight.status !== "reachable" || this.initialOptions.abortSignal?.aborted) {
        this.currentCycleOptions().onPlaybackEvent?.({
          type: "ipc-command-failed",
          command: "spawn",
          error: "addon stream refused: playback preflight failed",
        });
        await this.handleProcessTermination({ code: 1, signal: null });
        return;
      }
    }

    const proc = this.runtime.spawn([...mpvInvocation.argv, ...args], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      env: scrubbedChildEnv(),
    });
    this.mpv = proc;
    this.mpvUnregister = registerMpvProcess(proc);
    this.alive = true;
    // The first file is loaded from argv and never passes through IPC loadfile,
    // so it needs its owner seeded here or its file-loaded would be unowned.
    this.cycleGeneration = { process: this.cycleGeneration.process, cycle: 1 };
    this.installPendingFileLoad(this.cycleGeneration);
    this.initialOptions.onPlaybackEvent?.({ type: "mpv-process-started" });
    this.hasLoadedFile = true;
    this.resetCycleState();
    this.onControlReady(this.currentControl);

    proc.exited.then((code) => {
      void this.handleProcessTermination({
        code,
        signal: proc.killed ? ("SIGTERM" as NodeJS.Signals) : null,
      });
      return undefined;
    });

    {
      const ipcBootstrapStarted = Date.now();
      const ready = await this.runtime.waitForIpcEndpoint(this.ipcEndpoint, 5_000);
      // The session was closed while this wait was outstanding; opening IPC now
      // would resurrect a process that is already being torn down.
      if (this.retired) return;
      const waitedMs = Date.now() - ipcBootstrapStarted;
      if (!ready) {
        this.currentCycleOptions().onPlaybackEvent?.({
          type: "ipc-command-failed",
          command: "ipc-bootstrap",
          error: `IPC endpoint was not ready after ${waitedMs}ms at ${ipcServerCliArg(this.ipcEndpoint)}.${mpvIpcBootstrapDiagnosticsHintSuffix()}`,
        });
        await this.terminateAfterIpcBootstrapFailure(proc);
        return;
      }

      let openedIpcSession: MpvIpcSession;
      try {
        openedIpcSession = await this.runtime.openIpcSession({
          endpoint: this.ipcEndpoint,
          onPropertyUpdate: ({ name, value, observedAt }) => {
            this.propertyRouter.handlePropertyUpdate({ name, value, observedAt });
          },
          onEndFile: ({ reason, fileError, observedAt }) => {
            void this.handlePlaybackEnded(reason, observedAt, fileError);
          },
          onFileLoaded: () => {
            void this.releaseInitialConf();
            const pending = this.pendingFileLoad;
            // mpv's file-loaded carries no identity. Without a pending owner it
            // belongs to a load nobody is waiting for, so it must do nothing.
            if (!pending) return;
            this.pendingFileLoad = null;
            if (!this.isGenerationCurrent(pending.generation)) return;
            this.loadedFileGeneration = pending.generation;

            void this.ipcSession?.send(["set_property", "user-data/kunai-loading", ""], 300);
            const reconnect = this.pendingInProcessReconnect;
            if (reconnect) {
              this.pendingInProcessReconnect = null;
              if (!this.isGenerationCurrent(reconnect.generation)) return;
              void this.finishInProcessReconnectAfterLoad(reconnect);
              return;
            }
            this.drainPendingReadyWork();
          },
          onCommandResult: (result) => {
            const emit = this.currentCycleOptions().onPlaybackEvent;
            for (const event of mpvIpcFailureEvents(result, isSubtitleIpcCommand)) emit?.(event);
          },
        });
      } catch (error) {
        const totalMs = Date.now() - ipcBootstrapStarted;
        const message = error instanceof Error ? error.message : String(error);
        this.currentCycleOptions().onPlaybackEvent?.({
          type: "ipc-command-failed",
          command: "ipc-bootstrap",
          error: `${message} (${totalMs}ms total)${mpvIpcBootstrapDiagnosticsHintSuffix()}`,
        });
        await this.terminateAfterIpcBootstrapFailure(proc);
        return;
      }

      if (this.retired) {
        // Close the handle we just created exactly once and install nothing.
        await openedIpcSession.close().catch(() => {});
        return;
      }
      this.ipcSession = openedIpcSession;

      dbg("mpv-ipc", "ipc-bootstrap-complete", {
        ipcTransport: mpvIpcTransportTag(this.ipcEndpoint),
        endpoint: ipcServerCliArg(this.ipcEndpoint),
        bootstrapMs: Date.now() - ipcBootstrapStarted,
        mode: "PersistentMpvSession",
      });

      this.currentCycleOptions().onPlaybackEvent?.({ type: "ipc-connected" });
      this.currentCycleOptions().onPlaybackEvent?.({ type: "opening-stream" });

      // Observe user-data properties written by the kunai Lua script so that
      // key presses inside the mpv window are routed back to the app.
      void this.ipcSession.send(["observe_property", 200, "user-data/kunai-request"], 1_000);
      void this.ipcSession.send(["observe_property", 201, "user-data/kunai-resume-choice"], 1_000);
      void this.ipcSession.send(["observe_property", 202, "user-data/kunai-track-changed"], 1_000);
      void this.ipcSession.send(["observe_property", 203, "pause"], 1_000);
    }
    this.queueReadyWork(this.initialOptions, { armFallback: false });
    this.armReadyWorkFallback(
      this.initialOptions,
      PersistentMpvSession.loadfileReadyWorkFallbackMs,
    );
  }

  private beginCycle(
    options: PlayerCycleOptions,
    cycleOptions: { acceptPlaybackProperties?: boolean } = {},
  ): PlayerCycleState {
    const stats = createPlayerStatsState(this.ipcEndpoint.path);
    let resolve!: (result: PlaybackResult) => void;
    const promise = new Promise<PlaybackResult>((res) => {
      resolve = res;
    });
    const output = createPlaybackOutputDriver({
      gate: this.runtime.createPlaybackOutputGate?.(),
      stats,
      readVideoOutput: async () => readMpvVideoOutput(this.ipcSession),
      isCurrent: () => this.activeCycle === cycle,
      emit: (event) => cycle.onPlaybackEvent?.(event),
    });
    const cycle: PlayerCycleState = {
      stats,
      resolve,
      promise,
      playerReadyNotified: false,
      onPlayerReady: options.onPlayerReady,
      onPlaybackEvent: options.onPlaybackEvent,
      output,
      lastPlaybackProgressEventAtMs: 0,
      lastPlaybackProgressPositionSeconds: -1,
      lastPlaybackProgressDurationSeconds: 0,
      acceptPlaybackProperties: cycleOptions.acceptPlaybackProperties ?? true,
    };
    this.propertyRouter.resetSubtitleObservation();
    this.subtitleManager.resetSelectionObservation();
    this.activeCycle = cycle;
    this.currentOptions = options;
    return cycle;
  }

  private finishResumeChoiceWait(choice: PersistentResumeStartChoice): void {
    const w = this.resumeChoiceWait;
    if (!w) return;
    clearTimeout(w.timeoutId);
    this.resumeChoiceWait = null;
    w.resolve(choice);
    void this.ipcSession?.send(["set_property", "user-data/kunai-resume-at", 0], 300);
    void this.ipcSession?.send(["set_property", "user-data/kunai-resume-choice", ""], 300);
  }

  /** If playback ends while the resume prompt is open, skip the resume seek. */
  private abortResumeChoiceWaitForCycleEnd(): void {
    if (this.resumeChoiceWait) {
      this.finishResumeChoiceWait("start");
    }
  }

  private waitResumeOrStartOverChoice(
    seconds: number,
    displayTitle: string,
    timeLabel: string | undefined,
  ): Promise<PersistentResumeStartChoice> {
    if (!this.ipcSession) return Promise.resolve("resume");

    return new Promise<PersistentResumeStartChoice>((resolve) => {
      const timeoutId = setTimeout(() => {
        this.finishResumeChoiceWait("start");
      }, this.resumeChoiceTimeoutMs);

      this.resumeChoiceWait = {
        resolve,
        timeoutId,
      };

      void (async () => {
        await this.ipcSession?.send(["set_property", "user-data/kunai-resume-choice", ""], 300);
        await this.ipcSession?.send(
          ["set_property", "user-data/kunai-resume-title", displayTitle],
          500,
        );
        if (timeLabel) {
          await this.ipcSession?.send(
            ["set_property", "user-data/kunai-resume-label", timeLabel],
            500,
          );
        } else {
          await this.ipcSession?.send(["set_property", "user-data/kunai-resume-label", ""], 300);
        }
        await this.ipcSession?.send(["set_property", "user-data/kunai-resume-at", seconds], 500);
      })();
    });
  }

  private resetCycleState(): void {
    this.watchdog?.reset();
    this.reconnectTryCount = 0;
    this.reconnectBackoffUntilMs = 0;
    this.reconnectInFlight = false;
    this.pendingInProcessReconnect = null;
    this.currentPositionSeconds = 0;
    this.skippedSegments = new Set<string>();
    this.lastSkipTo = -1;
    this.nearEofFired = false;
    this.clearSkipAutoTimer();
    this.skipPromptSegmentKey = null;
    if (this.ipcSession) {
      this.publishSkipPromptCleared();
    }
  }

  isGenerationCurrent(generation: PlaybackGeneration): boolean {
    return isSamePlaybackGeneration(generation, this.cycleGeneration);
  }

  /** Starts a new cycle generation and retires anything the previous one owned. */
  private advanceCycleGeneration(): PlaybackGeneration {
    this.cycleGeneration = {
      process: this.cycleGeneration.process,
      cycle: this.cycleGeneration.cycle + 1,
    };
    this.retirePendingFileLoad();
    this.loadedFileGeneration = null;
    this.pendingInProcessReconnect = null;
    return this.cycleGeneration;
  }

  /** Installs the one pending load owner, retiring any previous owner first. */
  private installPendingFileLoad(generation: PlaybackGeneration): number {
    this.retirePendingFileLoad();
    const id = this.nextFileLoadId++;
    this.pendingFileLoad = { id, generation };
    return id;
  }

  private retirePendingFileLoad(): void {
    this.pendingFileLoad = null;
  }

  /**
   * The scoped `--include` is consumed when mpv processes the file entry;
   * file-loaded, end-file and process exit are all after that point, so each
   * can release the deferred conf cleanup idempotently.
   */
  private async releaseInitialConf(): Promise<void> {
    const cleanup = this.initialConfCleanup;
    this.initialConfCleanup = null;
    await cleanup?.();
  }

  /** Clears the pending owner only when it is exactly the one that failed. */
  private clearPendingFileLoadIf(id: number, generation: PlaybackGeneration): void {
    const pending = this.pendingFileLoad;
    if (!pending) return;
    if (pending.id !== id) return;
    if (!isSamePlaybackGeneration(pending.generation, generation)) return;
    this.pendingFileLoad = null;
  }

  private queueReadyWork(options: PlayerCycleOptions, opts: { armFallback?: boolean } = {}): void {
    const generation = this.cycleGeneration;
    this.pendingReadyWork = { options, generation };
    this.clearReadyWorkFallback();
    if (!this.ipcSession) {
      this.pendingReadyWork = null;
      this.acceptPlaybackPropertiesForActiveCycle();
      void this.runReadyWork(options, generation);
      return;
    }
    if (opts.armFallback !== false) {
      this.armReadyWorkFallback(options);
    }
  }

  private armReadyWorkFallback(
    options: PlayerCycleOptions,
    timeoutMs = PersistentMpvSession.readyWorkFallbackMs,
  ): void {
    if (!this.ipcSession) return;
    this.clearReadyWorkFallback();
    this.readyWorkFallbackTimer = setTimeout(() => {
      this.readyWorkFallbackTimer = null;
      this.drainPendingReadyWork(options);
    }, timeoutMs);
  }

  private drainPendingReadyWork(expected?: PlayerCycleOptions): void {
    const pending = this.pendingReadyWork;
    if (!pending) return;
    if (expected && pending.options !== expected) return;
    if (!this.isGenerationCurrent(pending.generation)) {
      this.pendingReadyWork = null;
      return;
    }
    this.pendingReadyWork = null;
    this.clearReadyWorkFallback();
    this.acceptPlaybackPropertiesForActiveCycle();
    void this.runReadyWork(pending.options, pending.generation);
  }

  private acceptPlaybackPropertiesForActiveCycle(): void {
    if (this.activeCycle) {
      this.activeCycle.acceptPlaybackProperties = true;
    }
  }

  private async runReadyWork(
    options: PlayerCycleOptions,
    generation: PlaybackGeneration,
  ): Promise<void> {
    const executor = new PersistentReadyWorkExecutor({
      getIpcSession: () => this.ipcSession,
      getInitialOptions: () => this.initialOptions,
      getLoadStartAt: () => this.loadStartAt,
      getTitleAppliedViaArgs: () => this.titleAppliedViaArgs,
      setTitleAppliedViaArgs: (value) => {
        this.titleAppliedViaArgs = value;
      },
      getSubtitlesAttachedAtSpawn: () => this.subtitlesAttachedAtSpawn,
      setSubtitlesAttachedAtSpawn: (value) => {
        this.subtitlesAttachedAtSpawn = value;
      },
      setCurrentPositionSeconds: (value) => {
        this.currentPositionSeconds = value;
      },
      setResumeSeekPending: (value) => {
        this.resumeSeekPending = value;
      },
      waitResumeOrStartOverChoice: (seconds, displayTitle, timeLabel) =>
        this.waitResumeOrStartOverChoice(seconds, displayTitle, timeLabel),
      handleSegmentSkipProgress: async (readyOptions) =>
        this.handleSegmentSkipProgress(readyOptions),
      syncChaptersFile: (timing) => this.syncMpvChaptersFile(timing ?? null),
      isLiveStream: () => this.playbackStream.isLive === true,
      onIpcCommandFailure: (command, error) => {
        dbg("mpv-ipc", `${command}-failed`, { error });
      },
      subtitleManager: this.subtitleManager,
      isGenerationCurrent: (candidate) => this.isGenerationCurrent(candidate),
    });

    await executor.execute(options, this.activeCycle, generation);
  }

  private clearReadyWorkFallback(): void {
    if (!this.readyWorkFallbackTimer) return;
    clearTimeout(this.readyWorkFallbackTimer);
    this.readyWorkFallbackTimer = null;
  }

  private async replaceSubtitleInventory(
    primarySubtitle: string | null,
    subtitleTracks?: readonly SubtitleTrack[],
    onAttached?: (trackCount: number) => void,
    primarySubtitleUrlKind?: MpvUrlKind,
    isCurrent?: () => boolean,
  ): Promise<void> {
    await this.subtitleManager.replaceSubtitleInventory(
      this.ipcSession,
      primarySubtitle,
      subtitleTracks,
      onAttached,
      primarySubtitleUrlKind,
      isCurrent,
    );
  }

  private async reloadSubtitles(): Promise<void> {
    const active = this.activeCycle;
    if (!active || !this.ipcSession) return;
    await this.ipcSession.send(["sub-reload"], 1_000);
  }

  private async selectSubtitle(selection: {
    readonly subtitleUrl: string | null;
    readonly subtitleTracks?: readonly SubtitleTrack[];
  }): Promise<boolean> {
    if (!this.ipcSession) return false;
    const generation = this.cycleGeneration;
    if (!selection.subtitleUrl) {
      const result = await this.ipcSession.send(["set_property", "sid", "no"], 1_000);
      if (!this.isGenerationCurrent(generation)) return false;
      if (result.ok) {
        this.currentOptions = { ...this.currentOptions, subtitlePreference: "none" };
        this.subtitleManager.noteSelectedSubtitle(0, true);
      }
      return result.ok;
    }

    const previousOptions = this.currentOptions;
    const selectingOptions = { ...previousOptions, subtitlePreference: "interactive" };
    this.currentOptions = selectingOptions;
    this.subtitleManager.resetSelectionObservation();
    // Refresh file-local IDs before selecting: a picker must not grow mpv's
    // external inventory on each click or replay IDs from a replaced file.
    const tracks = await this.ipcSession.send(["get_property", "track-list"], 1_000);
    if (!this.isGenerationCurrent(generation)) return false;
    if (tracks.ok && Array.isArray(tracks.response.data))
      this.subtitleManager.updateTrackList(tracks.response.data);
    const localized = this.ownedSubtitleFiles?.existingPath(selection.subtitleUrl);
    const existingId = localized
      ? this.subtitleManager.findExternalSubtitleId(localized)
      : undefined;
    let selected = false;
    if (existingId !== undefined) {
      const result = await this.ipcSession.send(["set_property", "sid", existingId], 1_000);
      selected = result.ok;
      // mpv need not re-emit an unchanged sid; an acknowledged selection is
      // authoritative for late-attachment policy in this file generation.
      if (result.ok && this.isGenerationCurrent(generation))
        this.subtitleManager.noteSelectedSubtitle(existingId);
    } else {
      const attached = await this.subtitleManager.attachSubtitles(
        this.ipcSession,
        {
          primarySubtitle: selection.subtitleUrl,
          subtitleTracks: selection.subtitleTracks?.filter(
            (track) => track.url === selection.subtitleUrl,
          ),
        },
        () => this.isGenerationCurrent(generation),
      );
      selected = attached.attachedCount > 0;
    }
    if (!this.isGenerationCurrent(generation)) return false;
    if (!selected) {
      if (this.currentOptions === selectingOptions) this.currentOptions = previousOptions;
      return false;
    }
    const visibility = await this.ipcSession.send(["set_property", "sub-visibility", true], 1_000);
    if (!this.isGenerationCurrent(generation) || !visibility.ok) return false;
    return true;
  }

  private async attachSubtitles(attachment: LateSubtitleAttachment) {
    const generation = this.cycleGeneration;
    const result = await this.subtitleManager.attachSubtitles(
      this.ipcSession,
      attachment,
      () => !this.retired && this.isGenerationCurrent(generation),
      this.subtitleManager.shouldSelectLatePrimary(),
    );
    if (!this.isGenerationCurrent(generation)) return result;

    if (result.attachedCount > 0) {
      this.currentCycleOptions().onPlaybackEvent?.({
        type: "late-subtitles-attached",
        trackCount: result.attachedCount,
      });
    }
    return result;
  }

  private currentCycleOptions(): PlayerCycleOptions {
    return this.currentOptions;
  }

  private maybeEmitPlaybackProgress(cycle: PlayerCycleState, observedAt: number): void {
    const sample = cycle.stats.latestIpcSample;
    if (
      !shouldEmitPlaybackProgress(
        cycle,
        sample
          ? {
              positionSeconds: sample.positionSeconds,
              durationSeconds: sample.durationSeconds,
            }
          : null,
        observedAt,
      ) ||
      !sample
    ) {
      return;
    }
    cycle.onPlaybackEvent?.({
      type: "playback-progress",
      positionSeconds: sample.positionSeconds,
      durationSeconds: sample.durationSeconds,
    });
  }

  private fireNearEofIfNeeded(positionSeconds: number): void {
    if (this.nearEofFired) return;
    const duration = this.activeCycle?.stats.latestIpcSample?.durationSeconds ?? 0;
    const triggerSeconds = resolveNearEofPrefetchTriggerSeconds(
      duration,
      this.currentCycleOptions().timing,
    );
    if (triggerSeconds === null || positionSeconds < triggerSeconds) return;
    this.nearEofFired = true;
    this.currentCycleOptions().onNearEof?.();
  }

  private skipConfig(options: PlayerCycleOptions): PlaybackSkipConfig {
    return {
      skipRecap: options.autoSkipEnabled !== false && (options.skipRecap ?? true),
      skipIntro: options.autoSkipEnabled !== false && (options.skipIntro ?? true),
      skipPreview: false,
      skipCredits: options.autoSkipEnabled !== false && (options.skipCredits ?? true),
      autoNextEnabled: options.autoSkipEnabled !== false && (options.autoNextEnabled ?? false),
    };
  }

  private clearSkipAutoTimer(): void {
    if (this.skipAutoTimer) {
      clearTimeout(this.skipAutoTimer);
      this.skipAutoTimer = null;
    }
  }

  private bumpSkipUserDataRev(): void {
    this.skipUserDataRev += 1;
    this.ipcSession?.sendUnchecked([
      "set_property",
      "user-data/kunai-skip-rev",
      this.skipUserDataRev,
    ]);
  }

  /** Clears skip prompt user-data and notifies mpv Lua to hide the overlay. */
  private publishSkipPromptCleared(): void {
    if (!this.ipcSession) return;
    this.lastSkipTo = -1;
    this.ipcSession.sendUnchecked(["set_property", "user-data/kunai-skip-to", -1]);
    this.ipcSession.sendUnchecked(["set_property", "user-data/kunai-skip-auto", "0"]);
    this.ipcSession.sendUnchecked(["set_property", "user-data/kunai-skip-kind", ""]);
    this.ipcSession.sendUnchecked(["set_property", "user-data/kunai-skip-label", ""]);
    this.ipcSession.sendUnchecked(["set_property", "user-data/kunai-skip-prompt-ms", 0]);
    this.bumpSkipUserDataRev();
  }

  private publishSkipPromptActive(segment: ActivePlaybackSkip, autoExecute: boolean): void {
    if (!this.ipcSession) return;
    const skipTo = segment.endSeconds;
    if (skipTo !== this.lastSkipTo) {
      this.lastSkipTo = skipTo;
      this.ipcSession.sendUnchecked(["set_property", "user-data/kunai-skip-to", skipTo]);
    }
    this.ipcSession.sendUnchecked([
      "set_property",
      "user-data/kunai-skip-auto",
      autoExecute ? "1" : "0",
    ]);
    this.ipcSession.sendUnchecked(["set_property", "user-data/kunai-skip-kind", segment.kind]);
    this.ipcSession.sendUnchecked([
      "set_property",
      "user-data/kunai-skip-label",
      playbackSkipKindLabel(segment.kind),
    ]);
    this.ipcSession.sendUnchecked([
      "set_property",
      "user-data/kunai-skip-prompt-ms",
      this.skipPromptDurationMs,
    ]);
    this.bumpSkipUserDataRev();
  }

  private clearSkipPromptState(): void {
    this.clearSkipAutoTimer();
    this.skipPromptSegmentKey = null;
    this.publishSkipPromptCleared();
  }

  /** Windows / no Lua: preserve instant auto-skip when toggles are on. */
  private async maybeAutoSkipLegacy(options: PlayerCycleOptions): Promise<boolean> {
    const activeSkip = findActivePlaybackSkip(
      options.timing,
      this.currentPositionSeconds,
      this.skipConfig(options),
    );
    const newSkipTo = activeSkip ? activeSkip.endSeconds : -1;
    if (newSkipTo !== this.lastSkipTo && this.ipcSession) {
      this.lastSkipTo = newSkipTo;
      this.ipcSession.sendUnchecked(["set_property", "user-data/kunai-skip-to", newSkipTo]);
    }
    if (!activeSkip || !this.ipcSession || this.skippedSegments.has(activeSkip.key)) return false;
    this.skippedSegments.add(activeSkip.key);
    await this.ipcSession.send(["seek", activeSkip.endSeconds, "absolute"], 1_000);
    options.onPlaybackEvent?.({ type: "segment-skipped", kind: activeSkip.kind, automatic: true });
    return true;
  }

  private async performSeekSkip(
    options: PlayerCycleOptions,
    segment: ActivePlaybackSkip,
    automatic: boolean,
  ): Promise<boolean> {
    if (!this.ipcSession || this.skippedSegments.has(segment.key)) {
      return false;
    }
    this.clearSkipPromptState();
    const seekResult = await this.ipcSession.send(["seek", segment.endSeconds, "absolute"], 1_000);
    if (!seekResult.ok) return false;
    this.skippedSegments.add(segment.key);
    options.onPlaybackEvent?.({ type: "segment-skipped", kind: segment.kind, automatic });
    return true;
  }

  private async fireScheduledAutoSkip(
    options: PlayerCycleOptions,
    expectedKey: string,
  ): Promise<void> {
    this.skipAutoTimer = null;
    if (!this.activeCycle || !this.ipcSession) return;
    const seg = findPlaybackSegmentAtPosition(options.timing, this.currentPositionSeconds);
    if (!seg || seg.key !== expectedKey) return;
    if (this.skippedSegments.has(seg.key)) return;
    if (!isPlaybackAutoSkipEnabled(seg.kind, this.skipConfig(options))) return;
    await this.performSeekSkip(options, seg, true);
  }

  private async handleResumeSeekFromMpv(): Promise<void> {
    const target = this.currentOptions.resumePromptAt;
    if (!target || target <= 0 || !this.ipcSession || !this.activeCycle) return;

    const seekResult = await this.ipcSession.send(["seek", target, "absolute"], 2_000);
    if (seekResult.ok) {
      this.currentPositionSeconds = target;
      noteTrustedSeek(this.activeCycle.stats, target);
    }
  }

  private async handleCopyShareFromMpv(): Promise<void> {
    const ctx = this.currentCycleOptions().shareLinkContext;
    if (!ctx) return;
    const position = Math.max(0, Math.round(this.currentPositionSeconds));
    const result = await copyShareLinkForContext({
      mode: ctx.mode,
      title: ctx.title,
      episode: ctx.episode,
      providerId: ctx.providerId,
      ...(position > 0 && { startSeconds: position }),
    });
    ctx.onCopied?.(result);
  }

  private async onSkipRequestFromMpv(automatic: boolean): Promise<void> {
    const options = this.currentCycleOptions();
    if (!this.ipcSession) return;
    const segment = findPlaybackSegmentAtPosition(options.timing, this.currentPositionSeconds);
    if (!segment || this.skippedSegments.has(segment.key)) return;
    this.clearSkipAutoTimer();
    await this.performSeekSkip(options, segment, automatic);
  }

  private maybeRearmSkippedSegmentsOnBackwardSeek(
    options: PlayerCycleOptions,
    previousPositionSeconds: number,
    nextPositionSeconds: number,
  ): void {
    // Ignore normal jitter; only treat meaningful backward seeks as re-arm events.
    if (nextPositionSeconds + 0.5 >= previousPositionSeconds) {
      return;
    }
    this.skippedSegments = pruneSkippedPlaybackSegmentKeys(
      this.skippedSegments,
      options.timing,
      nextPositionSeconds,
    );
    // If the current prompt segment was re-armed (or we're now inside a segment whose
    // prompt had faded), clear skipPromptSegmentKey so handleSegmentSkipProgress
    // re-publishes the chip instead of returning early at the identity check.
    if (this.skipPromptSegmentKey !== null) {
      const segmentAtNewPos = findPlaybackSegmentAtPosition(options.timing, nextPositionSeconds);
      if (
        segmentAtNewPos?.key === this.skipPromptSegmentKey &&
        !this.skippedSegments.has(this.skipPromptSegmentKey)
      ) {
        this.skipPromptSegmentKey = null;
      }
    }
  }

  private currentChaptersFilePath: string | null = null;

  private async syncMpvChaptersFile(timing: PlaybackTimingMetadata | null): Promise<void> {
    const oldPath = this.currentChaptersFilePath;
    if (!timing) {
      if (oldPath) {
        this.currentChaptersFilePath = null;
        if (this.ipcSession) {
          await this.ipcSession.send(["set_property", "chapters-file", ""], 1_000).catch(() => {});
        }
        await removeMpvChaptersFile(oldPath).catch(() => {});
      }
      return;
    }
    try {
      const newPath = await writeMpvChaptersFile(timing, `${this.id}-${Date.now()}`);
      if (newPath) {
        this.currentChaptersFilePath = newPath;
        if (this.ipcSession) {
          await this.ipcSession.send(["set_property", "chapters-file", newPath], 1_000);
        }
      }
      if (oldPath && oldPath !== newPath) {
        await removeMpvChaptersFile(oldPath);
      }
    } catch {
      // Best-effort chapters sync
    }
  }

  private async handleSegmentSkipProgress(options: PlayerCycleOptions): Promise<void> {
    if (!this.ipcSession) return;
    if (this.resumeSeekPending) return;

    if (!this.luaScriptPath) {
      await this.maybeAutoSkipLegacy(options);
      return;
    }

    const segment = findPlaybackSegmentAtPosition(options.timing, this.currentPositionSeconds);
    if (!segment) {
      if (this.skipPromptSegmentKey !== null) {
        this.clearSkipPromptState();
      } else if (this.lastSkipTo !== -1) {
        this.lastSkipTo = -1;
        this.ipcSession.sendUnchecked(["set_property", "user-data/kunai-skip-to", -1]);
      }
      return;
    }

    if (this.skippedSegments.has(segment.key)) {
      return;
    }

    if (this.skipPromptSegmentKey === segment.key) {
      return;
    }

    this.skipPromptSegmentKey = segment.key;
    this.clearSkipAutoTimer();

    const autoExecute = isPlaybackAutoSkipEnabled(segment.kind, this.skipConfig(options));
    this.publishSkipPromptActive(segment, autoExecute);

    if (autoExecute) {
      const expectedKey = segment.key;
      this.skipAutoTimer = setTimeout(() => {
        void this.fireScheduledAutoSkip(options, expectedKey);
      }, this.skipPromptDurationMs);
    }
  }

  private async skipCurrentSegment(): Promise<boolean> {
    const options = this.currentCycleOptions();
    const segment = findPlaybackSegmentAtPosition(options.timing, this.currentPositionSeconds);
    if (!segment || !this.ipcSession || this.skippedSegments.has(segment.key)) {
      return false;
    }
    this.clearSkipAutoTimer();
    return await this.performSeekSkip(options, segment, false);
  }

  private async waitForProcessClose(
    target: MpvProcess | null,
    timeoutMs: number,
  ): Promise<boolean> {
    if (!target) return true;
    return Promise.race([target.exited.then(() => true), Bun.sleep(timeoutMs).then(() => false)]);
  }

  private async terminateAfterIpcBootstrapFailure(target: MpvProcess): Promise<void> {
    const exit = await terminateMpvProcess(target);
    if (!exit.exited) {
      // Keep the child registered and the cycle unresolved. A later real
      // process exit will run handleProcessTermination; allowing fallback now
      // would knowingly stack another mpv over a still-live process.
      this.alive = false;
      this.currentCycleOptions().onPlaybackEvent?.({
        type: "ipc-command-failed",
        command: "terminate",
        error: "mpv did not exit after forced bootstrap teardown",
      });
      return;
    }
    await this.handleProcessTermination({
      code: exit.exitCode ?? 1,
      signal: exit.signal,
    });
  }

  private async closeIpcSession(): Promise<void> {
    const session = this.ipcSession;
    this.ipcSession = null;
    await session?.close().catch(() => {});
  }

  private async handleProcessTermination(exit: {
    code: number | null;
    signal: NodeJS.Signals | null;
  }): Promise<void> {
    if (this.terminationPromise) {
      await this.terminationPromise;
      return;
    }
    if (this.terminated) return;

    this.terminationPromise = (async () => {
      this.alive = false;
      this.retired = true;
      this.retirePendingFileLoad();
      this.loadedFileGeneration = null;
      this.clearReadyWorkFallback();
      this.pendingReadyWork = null;
      this.watchdog?.stop();
      this.watchdog = null;

      const active = this.activeCycle;
      this.activeCycle = null;

      await this.releaseInitialConf();
      await this.closeIpcSession();
      if (this.ownedSubtitleFiles) {
        const scope = this.ownedSubtitleFiles;
        this.ownedSubtitleFiles = undefined;
        await scope.close();
      }
      await this.cleanupSocket();
      await this.cleanupLuaScript();
      if (this.currentChaptersFilePath) {
        const fileToClean = this.currentChaptersFilePath;
        this.currentChaptersFilePath = null;
        await removeMpvChaptersFile(fileToClean);
      }

      this.mpvUnregister?.();
      this.mpvUnregister = null;
      this.mpv = null;
      this.hasLoadedFile = false;

      if (active) {
        recordPlayerExit(active.stats, exit);
        const result = finalizePlaybackResult(active.stats, {
          socketPathCleanedUp: shouldUnlinkUnixSocket(this.ipcEndpoint)
            ? !existsSync(this.ipcEndpoint.path)
            : true,
        });
        active.resolve(result);
      }

      this.currentCycleOptions().onPlaybackEvent?.({ type: "player-closed" });
      this.onControlReady(null);
      this.terminated = true;
    })();

    try {
      await this.terminationPromise;
    } finally {
      this.terminationPromise = null;
    }
  }

  private async cleanupSocket(): Promise<void> {
    if (!shouldUnlinkUnixSocket(this.ipcEndpoint)) return;
    if (!existsSync(this.ipcEndpoint.path)) return;
    await unlink(this.ipcEndpoint.path).catch(() => {});
  }

  private async cleanupLuaScript(): Promise<void> {
    if (!this.luaScriptPath) return;
    const path = this.luaScriptPath;
    this.luaScriptPath = null;
    if (isEphemeralKunaiLuaScript(path) && existsSync(path)) {
      await unlink(path).catch(() => {});
    }
  }

  private async handlePlaybackEnded(
    reason: string | null | undefined,
    observedAt: number,
    fileError?: string,
  ): Promise<void> {
    void this.releaseInitialConf();
    const active = this.activeCycle;
    if (!active) return;

    // The watchdog replaces a still-loaded file. mpv emits that old file's
    // end-file(stop) before the replacement's file-loaded, so it must not
    // retire the new load or resolve the watch cycle. Error/EOF reconnects
    // already ended their old file; genuine reload errors and user close
    // still follow normal teardown.
    if (
      reason === "stop" &&
      !this.retired &&
      this.reconnectInFlight &&
      isWatchdogReconnectTrigger(this.pendingInProcessReconnect?.trigger) &&
      this.pendingFileLoad?.generation === this.cycleGeneration
    ) {
      return;
    }

    // A reconnect's reload was still pending (loadfile ACKed, awaiting file-loaded)
    // but we got an end-file instead — the reload itself died (e.g. a dead CDN ACKs
    // loadfile then emits end-file error with no file-loaded). Clear the in-flight
    // flag so runSameUrlReconnect's guard does not block the next attempt within budget.
    if (this.reconnectInFlight) {
      this.reconnectInFlight = false;
      this.pendingInProcessReconnect = null;
    }

    this.abortResumeChoiceWaitForCycleEnd();
    this.clearReadyWorkFallback();
    this.pendingReadyWork = null;
    // end-file before file-loaded: that load will never arrive, so retire its
    // owner. A later unowned file-loaded is then correctly ignored.
    this.retirePendingFileLoad();
    this.loadedFileGeneration = null;
    if (!this.nearEofFired) {
      this.nearEofFired = true;
      this.currentCycleOptions().onNearEof?.();
    }

    applyEndFileEvent(active.stats, reason, observedAt, { fileError });
    const result = finalizePlaybackResult(active.stats, {
      socketPathCleanedUp: false,
    });

    const latest = active.stats.latestIpcSample ?? active.stats.lastNonZeroSample;
    const networkish = latest?.demuxerViaNetwork === true;
    const demoted = active.stats.eofDemotedByPrematureGuard;
    const seekFrom = Math.max(result.watchedSeconds, this.currentPositionSeconds);
    const durationForSeek =
      result.duration > 0
        ? result.duration
        : (active.stats.lastNonZeroSample?.durationSeconds ?? 0);

    const shouldTryReconnect =
      this.mpvInProcessStreamReconnectEnabled &&
      this.mpvInProcessStreamReconnectMaxAttempts > 0 &&
      this.reconnectTryCount < this.mpvInProcessStreamReconnectMaxAttempts &&
      this.ipcSession &&
      this.playbackStream.url.length > 0 &&
      (demoted || (result.endReason === "error" && networkish));

    if (shouldTryReconnect) {
      const trigger: InProcessReconnectTrigger = demoted ? "premature-eof" : "error";
      const reloaded = await this.runSameUrlReconnect(active, seekFrom, durationForSeek, trigger);
      if (reloaded) {
        return;
      }
    }

    this.activeCycle = null;
    active.resolve(result);
  }

  private async handleWatchdogReconnect(trigger: WatchdogReconnectTrigger): Promise<void> {
    if (
      !this.mpvInProcessStreamReconnectEnabled ||
      this.mpvInProcessStreamReconnectMaxAttempts <= 0
    ) {
      return;
    }
    const active = this.activeCycle;
    if (!active || !this.ipcSession) return;

    const latest = active.stats.latestIpcSample;
    const duration = latest?.durationSeconds ?? 0;
    const reloaded = await this.runSameUrlReconnect(
      active,
      this.currentPositionSeconds,
      duration,
      trigger,
    );
    if (!reloaded) {
      dbg("mpv-ipc", "in-process-reconnect-skipped", {
        reason: "backoff-or-limit-or-in-flight",
        attempt: this.reconnectTryCount,
      });
    }
  }

  /**
   * Reload the current stream URL inside the same mpv process. On success returns true and
   * keeps `activeCycle` alive; `file-loaded` runs seek + subtitle re-attach.
   */
  private async runSameUrlReconnect(
    active: PlayerCycleState,
    positionSeconds: number,
    durationSeconds: number,
    trigger: InProcessReconnectTrigger,
  ): Promise<boolean> {
    if (
      !this.mpvInProcessStreamReconnectEnabled ||
      this.mpvInProcessStreamReconnectMaxAttempts <= 0
    ) {
      return false;
    }
    if (!this.ipcSession || !this.playbackStream.url) return false;
    if (this.reconnectInFlight) return false;
    if (this.reconnectTryCount >= this.mpvInProcessStreamReconnectMaxAttempts) return false;

    const now = Date.now();
    if (now < this.reconnectBackoffUntilMs) return false;
    const reconnectGeneration = this.cycleGeneration;
    const isCurrent = () =>
      this.activeCycle === active && !this.retired && this.isGenerationCurrent(reconnectGeneration);

    const nextAttempt = this.reconnectTryCount + 1;
    const backoffBefore =
      nextAttempt > 1
        ? Math.min(this.reconnectMaxBackoffMs, this.reconnectBaseBackoffMs * 2 ** (nextAttempt - 2))
        : 0;
    if (backoffBefore > 0) {
      const sleepDeadline = Date.now() + backoffBefore;
      while (Date.now() < sleepDeadline) {
        if (!isCurrent()) return false;
        await Bun.sleep(Math.min(50, Math.max(1, sleepDeadline - Date.now())));
      }
      if (!isCurrent()) return false;
    }

    this.reconnectInFlight = true;
    this.reconnectTryCount = nextAttempt;
    const opts = this.currentCycleOptions();
    // A live broadcast has no meaningful absolute position to return to: seeking
    // back lands in the DVR window or fails outright. Gate once, here, so both the
    // loadfile `start` and the post-load seek in `finishInProcessReconnectAfterLoad`
    // follow from the same decision.
    const { seekSeconds, shouldSeek } = this.playbackStream.isLive
      ? { seekSeconds: 0, shouldSeek: false }
      : computeInProcessReconnectSeek(positionSeconds, durationSeconds);

    try {
      opts.onPlaybackEvent?.({
        type: "mpv-in-process-reconnect",
        phase: "started",
        attempt: this.reconnectTryCount,
        detail: trigger,
      });

      // An addon reload is strict-checked before anything is mutated: a stale
      // or refused verdict must leave no pending owner and no replaced stats.
      const reconnectAddon = isStremioPlayback(this.playbackStream);
      if (reconnectAddon) {
        const preflight = await (this.runtime.checkAddonPreflight ?? checkStremioPlaybackPreflight)(
          this.playbackStream,
          opts.abortSignal,
        );
        // A stale continuation must not clear a new owner's reconnectInFlight.
        if (!isCurrent()) return false;
        if (preflight.status !== "reachable" || opts.abortSignal?.aborted) {
          this.reconnectInFlight = false;
          return false;
        }
      }

      const savedEndReason = active.stats.endReason;
      const savedMaxTrusted = active.stats.maxTrustedProgressSeconds;
      const savedLastReliable = active.stats.lastReliableProgressSeconds;
      active.stats = createPlayerStatsState(this.ipcEndpoint.path);
      active.stats.endReason = savedEndReason;
      active.stats.maxTrustedProgressSeconds = savedMaxTrusted;
      active.stats.lastReliableProgressSeconds = savedLastReliable;
      // Reconnect reloads the same cycle: keep its generation, but retire the
      // previous pending owner so two load owners never coexist.
      this.pendingInProcessReconnect = {
        seekSeconds,
        shouldSeek,
        trigger,
        generation: reconnectGeneration,
      };
      const reconnectLoadId = this.installPendingFileLoad(reconnectGeneration);
      this.clearReadyWorkFallback();
      this.pendingReadyWork = null;

      const loadResult = await this.ipcSession.send(
        buildPersistentLoadfileCommand(
          this.playbackStream.url,
          shouldSeek ? seekSeconds : 0,
          this.playbackStream.headers,
          {
            requiresYtdl: this.playbackStream.requiresYtdl,
            ytdlFormat: this.playbackStream.ytdlFormat,
            ytdlRawOptions: this.playbackStream.ytdlRawOptions,
            isLive: this.playbackStream.isLive,
            urlKind: opts.urlKind,
            audioPreference: opts.audioPreference,
            subtitlePreference: opts.subtitlePreference,
            chaptersFile: this.currentChaptersFilePath ?? undefined,
            stremioAddon: reconnectAddon,
          },
        ),
        12_000,
      );
      if (!loadResult.ok) {
        this.clearPendingFileLoadIf(reconnectLoadId, reconnectGeneration);
        throw new Error(loadResult.error ?? "loadfile failed");
      }
      if (!this.isGenerationCurrent(reconnectGeneration)) return false;

      this.reconnectBackoffUntilMs = 0;
      void this.ipcSession.send(["set_property", "user-data/kunai-loading", ""], 500);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.pendingInProcessReconnect = null;
      this.reconnectInFlight = false;
      this.reconnectBackoffUntilMs =
        Date.now() +
        Math.min(
          this.reconnectMaxBackoffMs,
          this.reconnectBaseBackoffMs * 2 ** (this.reconnectTryCount - 1),
        );
      opts.onPlaybackEvent?.({
        type: "mpv-in-process-reconnect",
        phase: "failed",
        attempt: this.reconnectTryCount,
        detail: `${trigger}: ${message}`,
      });
      return false;
    }
  }

  private async finishInProcessReconnectAfterLoad(spec: {
    seekSeconds: number;
    shouldSeek: boolean;
    trigger: InProcessReconnectTrigger;
    generation: PlaybackGeneration;
  }): Promise<void> {
    const isCurrent = () => this.isGenerationCurrent(spec.generation);
    if (!isCurrent()) return;
    const opts = this.currentCycleOptions();
    try {
      if (spec.shouldSeek && this.ipcSession) {
        const seekResult = await this.ipcSession.send(
          ["seek", spec.seekSeconds, "absolute"],
          3_000,
        );
        if (!isCurrent()) return;
        if (seekResult.ok) {
          this.currentPositionSeconds = spec.seekSeconds;
        }
      }
      await this.ipcSession?.send(["set_property", "pause", false], 500);
      if (!isCurrent()) return;

      await this.replaceSubtitleInventory(
        opts.primarySubtitle,
        opts.subtitleTracks,
        (trackCount) => {
          opts.onPlaybackEvent?.({ type: "subtitle-inventory-ready", trackCount });
          opts.onPlaybackEvent?.({ type: "subtitle-attached", trackCount });
        },
        opts.subtitleUrlKind,
        isCurrent,
      );
      if (!isCurrent()) return;

      opts.onPlaybackEvent?.({
        type: "mpv-in-process-reconnect",
        phase: "complete",
        attempt: this.reconnectTryCount,
        detail: spec.trigger,
      });
    } catch (error) {
      if (!isCurrent()) return;
      const message = error instanceof Error ? error.message : String(error);
      opts.onPlaybackEvent?.({
        type: "mpv-in-process-reconnect",
        phase: "failed",
        attempt: this.reconnectTryCount,
        detail: `${spec.trigger}: ${message}`,
      });
    } finally {
      if (isCurrent()) {
        this.reconnectInFlight = false;
        this.nearEofFired = false;
        await this.handleSegmentSkipProgress(opts);
      }
    }
  }
}

async function unlinkIfExists(path: string): Promise<void> {
  if (!existsSync(path)) return;
  await unlink(path).catch(() => {});
}
