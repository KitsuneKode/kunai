import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";

import type {
  PlaybackResult,
  PlaybackTimingMetadata,
  StreamInfo,
  SubtitleTrack,
} from "@/domain/types";
import { dbg } from "@/logger";
import { buildMpvArgs, shouldApplyStartAtSeek } from "@/mpv";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { checkStreamPreflight } from "@/services/playback/stream-health-check";

import {
  buildKunaiBridgeScriptOptsArg,
  isEphemeralKunaiLuaScript,
  parseSkipPromptDurationMs,
  resolveKunaiMpvBridgeScriptPath,
} from "./kunai-mpv-bridge";
import { computeInProcessReconnectSeek } from "./mpv-in-process-reconnect";
import type { MpvIpcSession, PersistentMpvSessionRuntime } from "./mpv-ipc";
import { openMpvIpcSession, waitForMpvIpcEndpoint } from "./mpv-ipc";
import {
  createMpvIpcEndpoint,
  ipcServerCliArg,
  mpvIpcBootstrapDiagnosticsHintSuffix,
  mpvIpcTransportTag,
  newMpvIpcSessionId,
  shouldUnlinkUnixSocket,
} from "./mpv-ipc-endpoint";
import type { MpvRuntimeOptions } from "./mpv-runtime-options";
import {
  applyEndFileEvent,
  createPlayerTelemetryState,
  finalizePlaybackResult,
  noteStreamStall,
  noteTrustedSeek,
  recordPlayerExit,
  type PlayerTelemetryState,
} from "./mpv-telemetry";
import { PersistentMpvPropertyRouter } from "./persistent-mpv-property-router";
import { PersistentReadyWorkExecutor } from "./persistent-ready-work-executor";
import {
  buildPersistentLoadfileCommand,
  resolveNearEofPrefetchTriggerSeconds,
  resolvePersistentStartSeekTarget,
  type PersistentResumeStartChoice,
} from "./persistent-ready-work-policy";
import { PersistentSubtitleManager } from "./persistent-subtitle-manager";
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
import { buildPlaybackTelemetrySnapshot } from "./PlaybackTelemetrySnapshot";
import type { ActivePlayerControl } from "./PlayerControlService";
import type { LateSubtitleAttachment, PlayerPlaybackEvent } from "./PlayerService";
import { extractExternalSubtitleIds } from "./subtitle-track-cache";

export {
  buildPersistentLoadfileCommand,
  extractExternalSubtitleIds,
  resolveNearEofPrefetchTriggerSeconds,
  resolvePersistentStartSeekTarget,
};

const IN_PROCESS_RECONNECT_BASE_BACKOFF_MS = 1_800;
const IN_PROCESS_RECONNECT_MAX_BACKOFF_MS = 16_000;

type InProcessReconnectTrigger = "network-read-dead" | "premature-eof" | "error";

type MpvProcess = Pick<Bun.Subprocess, "exited" | "killed" | "exitCode" | "kill">;

const defaultPersistentMpvSessionRuntime: PersistentMpvSessionRuntime = {
  which: (command) => Bun.which(command),
  spawn: (command, options) => Bun.spawn(command, options),
  waitForIpcEndpoint: waitForMpvIpcEndpoint,
  openIpcSession: openMpvIpcSession,
};

type PlayerCycleOptions = {
  displayTitle: string;
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
  /** Called when the user presses N or P inside the mpv window. The mpv process
   *  handles the stop itself; the app only needs to record the intent. */
  onMpvActionRequest?: (action: "next" | "previous" | "pick-quality" | "refresh") => void;
  /** Called once when playback reaches the credits prefetch window or the final ~30 s fallback. */
  onNearEof?: () => void;
};

type PlayerCycleState = {
  telemetry: PlayerTelemetryState;
  resolve: (result: PlaybackResult) => void;
  promise: Promise<PlaybackResult>;
  playerReadyNotified: boolean;
  playerStartedNotified: boolean;
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
  private ipcSession: MpvIpcSession | null = null;
  private activeCycle: PlayerCycleState | null = null;
  private readonly subtitleManager = new PersistentSubtitleManager();
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
  private currentHeadersKey = "";
  private currentControl: ActivePlayerControl;
  private hasLoadedFile = false;
  private currentPositionSeconds = 0;
  private skippedSegments = new Set<string>();
  private currentOptions: PlayerCycleOptions;
  private watchdog: PlaybackWatchdog | null = null;
  private pendingReadyWork: PlayerCycleOptions | null = null;
  private readyWorkFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private terminationPromise: Promise<void> | null = null;
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

  private resumeChoiceWait: {
    resolve: (choice: PersistentResumeStartChoice) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  } | null = null;

  private playbackStream: StreamInfo;
  private mpvInProcessStreamReconnectEnabled = true;
  private mpvInProcessStreamReconnectMaxAttempts = 3;
  private reconnectTryCount = 0;
  private reconnectBackoffUntilMs = 0;
  private reconnectInFlight = false;
  private pendingInProcessReconnect: {
    seekSeconds: number;
    shouldSeek: boolean;
    trigger: InProcessReconnectTrigger;
  } | null = null;

  private constructor(
    private readonly initialStream: StreamInfo,
    private readonly initialOptions: PlayerCycleOptions,
    private readonly onControlReady: (control: ActivePlayerControl | null) => void,
    private readonly runtime: PersistentMpvSessionRuntime,
  ) {
    this.playbackStream = initialStream;
    this.currentHeadersKey = this.buildHeadersKey(initialStream.headers ?? {});
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
      attachSubtitles: async (attachment) => await this.attachSubtitles(attachment),
      skipCurrentSegment: async () => this.skipCurrentSegment(),
      updateTiming: (timing) => this.updateTiming(timing),
      getTelemetrySnapshot: () =>
        this.activeCycle ? buildPlaybackTelemetrySnapshot(this.activeCycle.telemetry) : null,
      showOsdMessage: async (text, durationMs) => {
        await this.ipcSession?.send(["show-text", text, durationMs], 1_000);
      },
      setEpisodeTransitionLoading: async (message) => {
        await this.ipcSession?.send(
          ["set_property", "user-data/kunai-loading", message ?? ""],
          1_000,
        );
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
    session.mpvInProcessStreamReconnectMaxAttempts =
      typeof maxAttempts === "number" && Number.isFinite(maxAttempts)
        ? Math.max(0, Math.min(12, Math.trunc(maxAttempts)))
        : 3;
    session.skipPromptDurationMs = parseSkipPromptDurationMs(cfg.mpvKunaiScriptOpts);
    session.scriptOptsArg = buildKunaiBridgeScriptOptsArg(cfg.mpvKunaiScriptOpts);
    session.luaScriptPath = await resolveKunaiMpvBridgeScriptPath(cfg);
    await session.spawn(opts.mpv);
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
    this.currentHeadersKey = this.buildHeadersKey(stream.headers ?? {});
    const cycle = this.beginCycle(options, { acceptPlaybackProperties: false });
    this.resetCycleState();
    options.onPlaybackEvent?.({ type: "opening-stream" });

    if (!this.hasLoadedFile) {
      this.hasLoadedFile = true;
      this.queueReadyWork(options);
      return await cycle.promise;
    }

    await this.subtitleManager.removeExternalSubtitles(this.ipcSession);
    options.onPlaybackEvent?.({ type: "resolving-playback" });
    this.queueReadyWork(options, { armFallback: false });

    this.loadStartAt = shouldApplyStartAtSeek(options.startAt) ? (options.startAt ?? 0) : 0;

    const isFreshCached = (stream.timestamp ?? 0) > Date.now() - 5 * 60 * 1000;
    const preflightPromise = isFreshCached
      ? Promise.resolve<Awaited<ReturnType<typeof checkStreamPreflight>>>({
          status: "reachable" as const,
        })
      : checkStreamPreflight(stream.url, stream.headers, 3_000);

    const loadResult = await this.ipcSession?.send(
      buildPersistentLoadfileCommand(stream.url, options.startAt),
      3_000,
    );

    const preflight = await preflightPromise;
    if (preflight.status === "unreachable" && preflight.definitive && !loadResult?.ok) {
      void this.ipcSession?.send(["set_property", "user-data/kunai-loading", ""], 500);
      options.onPlaybackEvent?.({
        type: "ipc-command-failed",
        command: "loadfile",
        error: `stream unreachable: ${preflight.reason}`,
      });
      cycle.telemetry.endReason = "error";
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

  matchesHeaders(headers: Record<string, string> | undefined): boolean {
    return this.currentHeadersKey === this.buildHeadersKey(headers ?? {});
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
  }

  waitForCurrentPlayback(): Promise<PlaybackResult> {
    if (!this.activeCycle) {
      throw new Error("Persistent MPV session has no active playback");
    }
    return this.activeCycle.promise;
  }

  async close(): Promise<void> {
    this.currentCycleOptions().onPlaybackEvent?.({ type: "player-closing" });
    this.clearReadyWorkFallback();
    this.pendingReadyWork = null;
    this.alive = false;

    const target = this.mpv;

    if (this.ipcSession) {
      this.abortResumeChoiceWaitForCycleEnd();
      void this.ipcSession.send(["set_property", "user-data/kunai-loading", ""], 500);
      const result = await this.ipcSession.send(["quit"], 1_000);
      if (!result.ok) {
        target?.kill("SIGTERM");
      }
    } else {
      target?.kill("SIGTERM");
    }

    const closed = await this.waitForProcessClose(target, 1_500);
    if (!closed) {
      target?.kill("SIGTERM");
    }

    await this.handleProcessTermination({
      code: target?.exitCode ?? (closed ? 0 : null),
      signal: target?.killed ? ("SIGTERM" as NodeJS.Signals) : closed ? null : "SIGTERM",
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
    const args = buildMpvArgs(
      {
        url: this.initialStream.url,
        headers: this.initialStream.headers ?? {},
        audioPreference: this.initialOptions.audioPreference,
        subtitlePreference: this.initialOptions.subtitlePreference,
        subtitle: this.initialOptions.primarySubtitle,
        subtitleTracks: this.initialOptions.subtitleTracks,
        displayTitle: this.initialOptions.displayTitle,
        startAt: this.initialOptions.startAt,
      },
      ipcServerCliArg(this.ipcEndpoint),
      {
        persistent: true,
        mpv: mpvOptions,
        includeStartArg,
        scriptPath: this.luaScriptPath ?? undefined,
        scriptOpts: this.scriptOptsArg,
      },
    );
    this.loadStartAt =
      includeStartArg && this.initialOptions.startAt ? this.initialOptions.startAt : 0;
    this.subtitlesAttachedAtSpawn = Boolean(this.initialOptions.primarySubtitle);
    this.titleAppliedViaArgs = true;

    const emitPlaybackEvent = (event: PlayerPlaybackEvent) => {
      const active = this.activeCycle;
      if (active && (event.type === "stream-stalled" || event.type === "ipc-stalled")) {
        noteStreamStall(active.telemetry, Date.now());
      }
      this.currentCycleOptions().onPlaybackEvent?.(event);
      if (
        this.mpvInProcessStreamReconnectEnabled &&
        this.mpvInProcessStreamReconnectMaxAttempts > 0 &&
        event.type === "stream-stalled" &&
        event.stallKind === "network-read-dead"
      ) {
        void this.handleNetworkReadDeadReconnect();
      }
    };
    this.watchdog = createPlaybackWatchdog(emitPlaybackEvent);

    if (!this.runtime.which("mpv")) {
      this.currentCycleOptions().onPlaybackEvent?.({
        type: "ipc-command-failed",
        command: "spawn",
        error: "mpv is not installed or not found on PATH",
      });
      await this.handleProcessTermination({ code: 1, signal: null });
      return;
    }

    const proc = this.runtime.spawn(["mpv", ...args], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      env: process.env as Record<string, string>,
    });
    this.mpv = proc;
    this.alive = true;
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
      const waitedMs = Date.now() - ipcBootstrapStarted;
      if (!ready) {
        this.currentCycleOptions().onPlaybackEvent?.({
          type: "ipc-command-failed",
          command: "ipc-bootstrap",
          error: `IPC endpoint was not ready after ${waitedMs}ms at ${ipcServerCliArg(this.ipcEndpoint)}.${mpvIpcBootstrapDiagnosticsHintSuffix()}`,
        });
        proc.kill("SIGTERM");
        await this.handleProcessTermination({ code: 1, signal: null });
        return;
      }

      try {
        this.ipcSession = await this.runtime.openIpcSession({
          endpoint: this.ipcEndpoint,
          onPropertyUpdate: ({ name, value, observedAt }) => {
            this.propertyRouter.handlePropertyUpdate({ name, value, observedAt });
          },
          onEndFile: ({ reason, observedAt }) => {
            void this.handlePlaybackEnded(reason, observedAt);
          },
          onFileLoaded: () => {
            void this.ipcSession?.send(["set_property", "user-data/kunai-loading", ""], 300);
            const reconnect = this.pendingInProcessReconnect;
            if (reconnect) {
              this.pendingInProcessReconnect = null;
              void this.finishInProcessReconnectAfterLoad(reconnect);
              return;
            }
            this.drainPendingReadyWork();
          },
          onCommandResult: (result) => {
            if (result.ok) return;
            this.currentCycleOptions().onPlaybackEvent?.({
              type: "ipc-command-failed",
              command: String(result.command[0] ?? "unknown"),
              error: result.error,
            });
            if (result.error === "timeout") {
              this.currentCycleOptions().onPlaybackEvent?.({
                type: "ipc-stalled",
                command: String(result.command[0] ?? "unknown"),
                error: result.error,
              });
            }
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
        proc.kill("SIGTERM");
        await this.handleProcessTermination({ code: 1, signal: null });
        return;
      }

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
    const telemetry = createPlayerTelemetryState(this.ipcEndpoint.path);
    let resolve!: (result: PlaybackResult) => void;
    const promise = new Promise<PlaybackResult>((res) => {
      resolve = res;
    });
    const cycle: PlayerCycleState = {
      telemetry,
      resolve,
      promise,
      playerReadyNotified: false,
      onPlayerReady: options.onPlayerReady,
      onPlaybackEvent: options.onPlaybackEvent,
      playerStartedNotified: false,
      lastPlaybackProgressEventAtMs: 0,
      lastPlaybackProgressPositionSeconds: -1,
      lastPlaybackProgressDurationSeconds: 0,
      acceptPlaybackProperties: cycleOptions.acceptPlaybackProperties ?? true,
    };
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
      }, PersistentMpvSession.resumeChoiceTimeoutMs);

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

  private queueReadyWork(options: PlayerCycleOptions, opts: { armFallback?: boolean } = {}): void {
    this.pendingReadyWork = options;
    this.clearReadyWorkFallback();
    if (!this.ipcSession) {
      this.pendingReadyWork = null;
      this.acceptPlaybackPropertiesForActiveCycle();
      void this.runReadyWork(options);
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
    if (expected && pending !== expected) return;
    this.pendingReadyWork = null;
    this.clearReadyWorkFallback();
    this.acceptPlaybackPropertiesForActiveCycle();
    void this.runReadyWork(pending);
  }

  private acceptPlaybackPropertiesForActiveCycle(): void {
    if (this.activeCycle) {
      this.activeCycle.acceptPlaybackProperties = true;
    }
  }

  private async runReadyWork(options: PlayerCycleOptions): Promise<void> {
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
      onIpcCommandFailure: (command, error) => {
        dbg("mpv-ipc", `${command}-failed`, { error });
      },
      subtitleManager: this.subtitleManager,
    });

    await executor.execute(options, this.activeCycle);
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
  ): Promise<void> {
    await this.subtitleManager.replaceSubtitleInventory(
      this.ipcSession,
      primarySubtitle,
      subtitleTracks,
      onAttached,
    );
  }

  private async reloadSubtitles(): Promise<void> {
    const active = this.activeCycle;
    if (!active || !this.ipcSession) return;
    await this.ipcSession.send(["sub-reload"], 1_000);
  }

  private async attachSubtitles(attachment: LateSubtitleAttachment): Promise<number> {
    const attached = await this.subtitleManager.attachSubtitles(this.ipcSession, attachment);

    if (attached > 0) {
      this.currentCycleOptions().onPlaybackEvent?.({
        type: "late-subtitles-attached",
        trackCount: attached,
      });
    }
    return attached;
  }

  private currentCycleOptions(): PlayerCycleOptions {
    return this.currentOptions;
  }

  private maybeEmitPlaybackProgress(cycle: PlayerCycleState, observedAt: number): void {
    const sample = cycle.telemetry.latestIpcSample;
    if (!sample || sample.positionSeconds <= 0) return;
    const durationChanged =
      sample.durationSeconds > 0 &&
      Math.abs(sample.durationSeconds - cycle.lastPlaybackProgressDurationSeconds) >= 1;
    const positionChanged =
      Math.abs(sample.positionSeconds - cycle.lastPlaybackProgressPositionSeconds) >= 15;
    if (
      cycle.lastPlaybackProgressEventAtMs > 0 &&
      !durationChanged &&
      !positionChanged &&
      observedAt - cycle.lastPlaybackProgressEventAtMs < 15_000
    ) {
      return;
    }
    cycle.lastPlaybackProgressEventAtMs = observedAt;
    cycle.lastPlaybackProgressPositionSeconds = sample.positionSeconds;
    cycle.lastPlaybackProgressDurationSeconds = sample.durationSeconds;
    cycle.onPlaybackEvent?.({
      type: "playback-progress",
      positionSeconds: sample.positionSeconds,
      durationSeconds: sample.durationSeconds,
    });
  }

  private fireNearEofIfNeeded(positionSeconds: number): void {
    if (this.nearEofFired) return;
    const duration = this.activeCycle?.telemetry.latestIpcSample?.durationSeconds ?? 0;
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
    if (!activeSkip || !this.ipcSession || this.skippedSegments.has(activeSkip.key)) {
      return false;
    }
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
      noteTrustedSeek(this.activeCycle.telemetry, target);
    }
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

  private buildHeadersKey(headers: Record<string, string>): string {
    return JSON.stringify({
      referer: headers.referer ?? headers.Referer ?? "",
      origin: headers.origin ?? headers.Origin ?? "",
      userAgent: headers["user-agent"] ?? headers["User-Agent"] ?? "",
    });
  }

  private async waitForProcessClose(
    target: MpvProcess | null,
    timeoutMs: number,
  ): Promise<boolean> {
    if (!target) return true;
    return Promise.race([target.exited.then(() => true), Bun.sleep(timeoutMs).then(() => false)]);
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
      this.clearReadyWorkFallback();
      this.pendingReadyWork = null;
      this.watchdog?.stop();
      this.watchdog = null;

      const active = this.activeCycle;
      this.activeCycle = null;

      await this.closeIpcSession();
      await this.cleanupSocket();
      await this.cleanupLuaScript();

      this.mpv = null;
      this.hasLoadedFile = false;

      if (active) {
        recordPlayerExit(active.telemetry, exit);
        const result = finalizePlaybackResult(active.telemetry, {
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
  ): Promise<void> {
    const active = this.activeCycle;
    if (!active) return;

    this.abortResumeChoiceWaitForCycleEnd();
    this.clearReadyWorkFallback();
    this.pendingReadyWork = null;
    if (!this.nearEofFired) {
      this.nearEofFired = true;
      this.currentCycleOptions().onNearEof?.();
    }

    applyEndFileEvent(active.telemetry, reason, observedAt);
    const result = finalizePlaybackResult(active.telemetry, {
      socketPathCleanedUp: false,
    });

    const latest = active.telemetry.latestIpcSample ?? active.telemetry.lastNonZeroSample;
    const networkish = latest?.demuxerViaNetwork === true;
    const demoted = active.telemetry.eofDemotedByPrematureGuard;
    const seekFrom = Math.max(result.watchedSeconds, this.currentPositionSeconds);
    const durationForSeek =
      result.duration > 0
        ? result.duration
        : (active.telemetry.lastNonZeroSample?.durationSeconds ?? 0);

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

  private async handleNetworkReadDeadReconnect(): Promise<void> {
    if (
      !this.mpvInProcessStreamReconnectEnabled ||
      this.mpvInProcessStreamReconnectMaxAttempts <= 0
    ) {
      return;
    }
    const active = this.activeCycle;
    if (!active || !this.ipcSession) return;

    const latest = active.telemetry.latestIpcSample;
    const duration = latest?.durationSeconds ?? 0;
    const reloaded = await this.runSameUrlReconnect(
      active,
      this.currentPositionSeconds,
      duration,
      "network-read-dead",
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

    const nextAttempt = this.reconnectTryCount + 1;
    const backoffBefore =
      nextAttempt > 1
        ? Math.min(
            IN_PROCESS_RECONNECT_MAX_BACKOFF_MS,
            IN_PROCESS_RECONNECT_BASE_BACKOFF_MS * 2 ** (nextAttempt - 2),
          )
        : 0;
    if (backoffBefore > 0) {
      await Bun.sleep(backoffBefore);
    }

    this.reconnectInFlight = true;
    this.reconnectTryCount = nextAttempt;
    const opts = this.currentCycleOptions();
    const { seekSeconds, shouldSeek } = computeInProcessReconnectSeek(
      positionSeconds,
      durationSeconds,
    );

    try {
      opts.onPlaybackEvent?.({
        type: "mpv-in-process-reconnect",
        phase: "started",
        attempt: this.reconnectTryCount,
        detail: trigger,
      });

      const savedEndReason = active.telemetry.endReason;
      const savedMaxTrusted = active.telemetry.maxTrustedProgressSeconds;
      const savedLastReliable = active.telemetry.lastReliableProgressSeconds;
      active.telemetry = createPlayerTelemetryState(this.ipcEndpoint.path);
      active.telemetry.endReason = savedEndReason;
      active.telemetry.maxTrustedProgressSeconds = savedMaxTrusted;
      active.telemetry.lastReliableProgressSeconds = savedLastReliable;
      this.pendingInProcessReconnect = { seekSeconds, shouldSeek, trigger };
      this.clearReadyWorkFallback();
      this.pendingReadyWork = null;

      const loadResult = await this.ipcSession.send(
        buildPersistentLoadfileCommand(this.playbackStream.url, shouldSeek ? seekSeconds : 0),
        12_000,
      );
      if (!loadResult.ok) {
        throw new Error(loadResult.error ?? "loadfile failed");
      }

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
          IN_PROCESS_RECONNECT_MAX_BACKOFF_MS,
          IN_PROCESS_RECONNECT_BASE_BACKOFF_MS * 2 ** (this.reconnectTryCount - 1),
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
  }): Promise<void> {
    const opts = this.currentCycleOptions();
    try {
      if (spec.shouldSeek && this.ipcSession) {
        const seekResult = await this.ipcSession.send(
          ["seek", spec.seekSeconds, "absolute"],
          3_000,
        );
        if (seekResult.ok) {
          this.currentPositionSeconds = spec.seekSeconds;
        }
      }
      await this.ipcSession?.send(["set_property", "pause", false], 500);

      await this.replaceSubtitleInventory(
        opts.primarySubtitle,
        opts.subtitleTracks,
        (trackCount) => {
          opts.onPlaybackEvent?.({ type: "subtitle-inventory-ready", trackCount });
          opts.onPlaybackEvent?.({ type: "subtitle-attached", trackCount });
        },
      );

      opts.onPlaybackEvent?.({
        type: "mpv-in-process-reconnect",
        phase: "complete",
        attempt: this.reconnectTryCount,
        detail: spec.trigger,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      opts.onPlaybackEvent?.({
        type: "mpv-in-process-reconnect",
        phase: "failed",
        attempt: this.reconnectTryCount,
        detail: `${spec.trigger}: ${message}`,
      });
    } finally {
      this.reconnectInFlight = false;
      this.nearEofFired = false;
      await this.handleSegmentSkipProgress(opts);
    }
  }
}

async function unlinkIfExists(path: string): Promise<void> {
  if (!existsSync(path)) return;
  await unlink(path).catch(() => {});
}
