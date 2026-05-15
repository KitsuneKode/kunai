import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";

import type {
  PlaybackResult,
  PlaybackTimingMetadata,
  StreamInfo,
  SubtitleTrack,
} from "@/domain/types";
import { dbg } from "@/logger";
import {
  buildMpvArgs,
  collectAdditionalSubtitleTracks,
  describeSubtitleTrackForMpv,
  shouldApplyStartAtSeek,
} from "@/mpv";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { checkStreamPreflight } from "@/services/playback/stream-health-check";

import {
  buildKunaiBridgeScriptOptsArg,
  isEphemeralKunaiLuaScript,
  parseSkipPromptDurationMs,
  resolveKunaiMpvBridgeScriptPath,
} from "./kunai-mpv-bridge";
import { computeInProcessReconnectSeek } from "./mpv-in-process-reconnect";
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
import type { MpvRuntimeOptions } from "./mpv-runtime-options";
import {
  applyEndFileEvent,
  applyObservedPropertySample,
  createPlayerTelemetryState,
  finalizePlaybackResult,
  noteStreamStall,
  noteTrustedSeek,
  recordPlayerExit,
  type PlayerTelemetryState,
} from "./mpv-telemetry";
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

const IN_PROCESS_RECONNECT_BASE_BACKOFF_MS = 1_800;
const IN_PROCESS_RECONNECT_MAX_BACKOFF_MS = 16_000;

type InProcessReconnectTrigger = "network-read-dead" | "premature-eof" | "error";
import type { LateSubtitleAttachment, PlayerPlaybackEvent } from "./PlayerService";

type MpvProcess = Pick<Bun.Subprocess, "exited" | "killed" | "exitCode" | "kill">;

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

export type PersistentResumeStartChoice = "resume" | "start";

export function resolvePersistentStartSeekTarget(
  options: Pick<PlayerCycleOptions, "startAt" | "resumePromptAt" | "offerResumeStartChoice">,
  choice?: PersistentResumeStartChoice,
): number | undefined {
  const resumePromptAt = options.resumePromptAt ?? 0;
  if (options.offerResumeStartChoice && shouldApplyStartAtSeek(resumePromptAt)) {
    return choice === "resume" ? resumePromptAt : undefined;
  }
  if (typeof options.startAt === "number" && shouldApplyStartAtSeek(options.startAt)) {
    return options.startAt;
  }
  return undefined;
}

export function resolveNearEofPrefetchTriggerSeconds(
  durationSeconds: number,
  timing?: PlaybackTimingMetadata | null,
): number | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 30) return null;
  const fallbackTrigger = Math.max(0, durationSeconds - 30);
  const creditsStart = (timing?.credits ?? [])
    .map((segment) => segment.startMs)
    .filter((startMs): startMs is number => typeof startMs === "number" && Number.isFinite(startMs))
    .map((startMs) => startMs / 1000)
    .filter(
      (startSeconds) =>
        startSeconds > 0 &&
        startSeconds < durationSeconds &&
        startSeconds >= Math.max(durationSeconds * 0.5, durationSeconds - 600),
    )
    .sort((left, right) => right - left)[0];
  if (creditsStart === undefined) return fallbackTrigger;
  return Math.max(0, Math.min(fallbackTrigger, creditsStart - 45));
}

export function buildPersistentLoadfileCommand(
  url: string,
  startAt?: number,
): ["loadfile", string, "replace", -1, { start: string }] {
  return [
    "loadfile",
    url,
    "replace",
    -1,
    { start: shouldApplyStartAtSeek(startAt) ? String(startAt) : "0" },
  ];
}

type PlayerCycleState = {
  telemetry: PlayerTelemetryState;
  resolve: (result: PlaybackResult) => void;
  promise: Promise<PlaybackResult>;
  playerReadyNotified: boolean;
  playerStartedNotified: boolean;
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
  private lastTrackList: unknown = null;
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
  }): Promise<PersistentMpvSession> {
    const session = new PersistentMpvSession(opts.stream, opts.options, opts.onControlReady);
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

    await this.removeExternalSubtitles();
    options.onPlaybackEvent?.({ type: "resolving-playback" });
    this.queueReadyWork(options, { armFallback: false });

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
        includeStartArg: shouldApplyStartAtSeek(this.initialOptions.startAt),
        scriptPath: this.luaScriptPath ?? undefined,
        scriptOpts: this.scriptOptsArg,
      },
    );

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

    if (!Bun.which("mpv")) {
      this.currentCycleOptions().onPlaybackEvent?.({
        type: "ipc-command-failed",
        command: "spawn",
        error: "mpv is not installed or not found on PATH",
      });
      await this.handleProcessTermination({ code: 1, signal: null });
      return;
    }

    const proc = Bun.spawn(["mpv", ...args], {
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
      const ready = await waitForMpvIpcEndpoint(this.ipcEndpoint, 5_000);
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
        this.ipcSession = await openMpvIpcSession({
          endpoint: this.ipcEndpoint,
          onPropertyUpdate: ({ name, value, observedAt }) => {
            const active = this.activeCycle;

            // user-data/kunai-request is written by the Lua script when the user
            // presses N/P inside mpv. Handle it regardless of activeCycle state.
            if (name === "user-data/kunai-request") {
              const req = typeof value === "string" ? value : null;
              if (req === "next" || req === "previous" || req === "quality" || req === "refresh") {
                this.currentCycleOptions().onMpvActionRequest?.(
                  req === "quality" ? "pick-quality" : req === "refresh" ? "refresh" : req,
                );
                void this.ipcSession?.send(["set_property", "user-data/kunai-request", ""], 500);
              } else if (req === "resume-seek") {
                void this.handleResumeSeekFromMpv();
                void this.ipcSession?.send(["set_property", "user-data/kunai-request", ""], 500);
              } else if (req === "skip" || req === "auto-skip") {
                const automatic = req === "auto-skip";
                void this.onSkipRequestFromMpv(automatic);
                void this.ipcSession?.send(["set_property", "user-data/kunai-request", ""], 500);
              }
              return;
            }

            if (name === "user-data/kunai-resume-choice") {
              const v = typeof value === "string" ? value : "";
              if ((v === "resume" || v === "start") && this.resumeChoiceWait) {
                this.finishResumeChoiceWait(v);
              }
              return;
            }

            if (name === "user-data/kunai-track-changed") {
              const v = typeof value === "string" ? value : "";
              if (v.startsWith("audio:")) {
                this.currentCycleOptions().onPlaybackEvent?.({
                  type: "track-changed",
                  trackType: "audio",
                  id: parseInt(v.split(":")[1] ?? "0"),
                });
              } else if (v.startsWith("sub:")) {
                this.currentCycleOptions().onPlaybackEvent?.({
                  type: "track-changed",
                  trackType: "sub",
                  id: parseInt(v.split(":")[1] ?? "0"),
                });
              }
              void this.ipcSession?.send(
                ["set_property", "user-data/kunai-track-changed", ""],
                500,
              );
              return;
            }

            if (!active) return;
            applyObservedPropertySample(
              active.telemetry,
              { name, value, observedAt },
              { acceptPlaybackProperties: active.acceptPlaybackProperties },
            );
            if (!active.acceptPlaybackProperties) return;
            if (active.telemetry.latestIpcSample) {
              this.watchdog?.observe(active.telemetry.latestIpcSample);
            }
            if (name === "track-list") {
              this.lastTrackList = value;
            }
            if ((name === "time-pos" || name === "playback-time") && typeof value === "number") {
              const previousPositionSeconds = this.currentPositionSeconds;
              this.currentPositionSeconds = value;
              this.maybeRearmSkippedSegmentsOnBackwardSeek(
                this.currentCycleOptions(),
                previousPositionSeconds,
                value,
              );
              if (value > 0 && !active.playerStartedNotified) {
                active.playerStartedNotified = true;
                active.onPlaybackEvent?.({ type: "playback-started" });
              }
              void this.handleSegmentSkipProgress(this.currentCycleOptions());

              // Prefetch once per cycle near credits when timing exists, else within 30s of end.
              if (!this.nearEofFired) {
                const duration = active.telemetry.latestIpcSample?.durationSeconds ?? 0;
                const triggerSeconds = resolveNearEofPrefetchTriggerSeconds(
                  duration,
                  this.currentCycleOptions().timing,
                );
                if (triggerSeconds !== null && value >= triggerSeconds) {
                  this.nearEofFired = true;
                  this.currentCycleOptions().onNearEof?.();
                }
              }
            }
            if (
              !active.playerReadyNotified &&
              (name === "filename" ||
                name === "media-title" ||
                (name === "playback-time" && typeof value === "number" && value >= 0))
            ) {
              active.playerReadyNotified = true;
              active.onPlaybackEvent?.({ type: "player-ready" });
              active.onPlayerReady?.();
            }
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
    }
    this.queueReadyWork(this.initialOptions);
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
    const cycle = this.activeCycle;
    if (!cycle) return;

    if (!cycle.playerReadyNotified) {
      cycle.playerReadyNotified = true;
      cycle.onPlaybackEvent?.({ type: "player-ready" });
      cycle.onPlayerReady?.();
    }

    if (!this.ipcSession) return;

    this.resumeSeekPending =
      shouldApplyStartAtSeek(options.startAt) || shouldApplyStartAtSeek(options.resumePromptAt);
    try {
      // Ensure playback is not paused when a new file loads. With --keep-open=no this is
      // normally a no-op, but guards against pause=yes persisting from a previous cycle
      // (e.g. user paused mid-episode then pressed N, or a keep-open edge case).
      const unpauseResult = await this.ipcSession.send(["set_property", "pause", false], 500);
      if (!unpauseResult.ok) {
        dbg("mpv-ipc", "unpause-failed", {
          error: unpauseResult.error,
        });
      }

      // Always push the display title for this episode so the mpv window title and
      // OSD stay correct across persistent-session episode transitions.
      const titleResult = await this.ipcSession.send(
        ["set_property", "force-media-title", options.displayTitle],
        1_000,
      );
      if (!titleResult.ok) {
        dbg("mpv-ipc", "set-title-failed", {
          error: titleResult.error,
        });
      }

      let choice: PersistentResumeStartChoice | undefined;
      const resumePromptAt = options.resumePromptAt ?? 0;
      if (options.offerResumeStartChoice && shouldApplyStartAtSeek(resumePromptAt)) {
        choice = await this.waitResumeOrStartOverChoice(
          resumePromptAt,
          options.displayTitle,
          options.resumeChoiceTimeLabel,
        );
      }
      const seekTarget = resolvePersistentStartSeekTarget(options, choice);

      if (shouldApplyStartAtSeek(seekTarget) && seekTarget !== undefined) {
        const target = seekTarget;
        options.onPlaybackEvent?.({ type: "resolving-playback" });
        const seekResult = await this.ipcSession.send(["seek", target, "absolute"], 2_000);
        // IPC time-pos may lag behind the seek; autoskip uses currentPositionSeconds — sync so
        // recap/intro windows are evaluated from the resume point, not from 0 (which would
        // incorrectly skip earlier segments after a mid-episode resume).
        if (seekResult.ok) {
          this.currentPositionSeconds = target;
          noteTrustedSeek(cycle.telemetry, target);
        }
      }
    } finally {
      this.resumeSeekPending = false;
    }

    await this.replaceSubtitleInventory(
      options.primarySubtitle,
      options.subtitleTracks,
      (trackCount) => {
        options.onPlaybackEvent?.({ type: "subtitle-inventory-ready", trackCount });
        options.onPlaybackEvent?.({ type: "subtitle-attached", trackCount });
      },
    );
    await this.handleSegmentSkipProgress(options);
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
    if (!this.ipcSession) return;

    await this.removeExternalSubtitles();

    if (primarySubtitle) {
      const primary = describeSubtitleTrackForMpv(primarySubtitle, subtitleTracks);
      const result = await this.ipcSession.send([
        "sub-add",
        primarySubtitle,
        "select",
        primary.title,
        primary.language,
      ]);
      if (!result.ok) return;
    }

    const additionalTracks = collectAdditionalSubtitleTracks(primarySubtitle, subtitleTracks);
    for (const track of additionalTracks) {
      const result = await this.ipcSession.send([
        "sub-add",
        track.url,
        "auto",
        track.display ?? "",
        track.language ?? "",
      ]);
      if (!result.ok) return;
    }
    const attachedCount = (primarySubtitle ? 1 : 0) + additionalTracks.length;
    if (attachedCount > 0) {
      onAttached?.(attachedCount);
    }
  }

  private async reloadSubtitles(): Promise<void> {
    const active = this.activeCycle;
    if (!active || !this.ipcSession) return;
    await this.ipcSession.send(["sub-reload"], 1_000);
  }

  private async attachSubtitles(attachment: LateSubtitleAttachment): Promise<number> {
    if (!this.ipcSession) return 0;
    let attached = 0;

    if (attachment.primarySubtitle) {
      const primary = describeSubtitleTrackForMpv(
        attachment.primarySubtitle,
        attachment.subtitleTracks,
      );
      const result = await this.ipcSession.send([
        "sub-add",
        attachment.primarySubtitle,
        "select",
        primary.title,
        primary.language,
      ]);
      if (result.ok) attached += 1;
    }

    for (const track of collectAdditionalSubtitleTracks(
      attachment.primarySubtitle ?? null,
      attachment.subtitleTracks,
    )) {
      const result = await this.ipcSession.send([
        "sub-add",
        track.url,
        "auto",
        track.display ?? "",
        track.language ?? "",
      ]);
      if (result.ok) attached += 1;
    }

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

  private async removeExternalSubtitles(): Promise<void> {
    if (!this.ipcSession) return;

    for (const trackId of extractExternalSubtitleIds(this.lastTrackList)) {
      await this.ipcSession.send(["sub-remove", trackId], 1_000);
    }
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

function extractExternalSubtitleIds(trackList: unknown): number[] {
  if (!Array.isArray(trackList)) return [];

  return trackList
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const track = entry as Record<string, unknown>;
      if (track.type !== "sub" || !track.external) return null;
      return typeof track.id === "number" ? track.id : null;
    })
    .filter((id): id is number => id !== null);
}

async function unlinkIfExists(path: string): Promise<void> {
  if (!existsSync(path)) return;
  await unlink(path).catch(() => {});
}
