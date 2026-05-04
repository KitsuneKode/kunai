import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";

import type {
  PlaybackResult,
  PlaybackTimingMetadata,
  StreamInfo,
  SubtitleTrack,
} from "@/domain/types";
import { buildMpvArgs, collectAdditionalSubtitleTracks, shouldApplyStartAtSeek } from "@/mpv";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

import {
  buildKunaiBridgeScriptOptsArg,
  isEphemeralKunaiLuaScript,
  parseSkipPromptDurationMs,
  resolveKunaiMpvBridgeScriptPath,
} from "./kunai-mpv-bridge";
import type { MpvIpcSession } from "./mpv-ipc";
import { openMpvIpcSession, waitForMpvIpcEndpoint } from "./mpv-ipc";
import { createMpvIpcEndpoint, ipcServerCliArg, shouldUnlinkUnixSocket } from "./mpv-ipc-endpoint";
import type { MpvRuntimeOptions } from "./mpv-runtime-options";
import {
  applyEndFileEvent,
  applyObservedPropertySample,
  createPlayerTelemetryState,
  finalizePlaybackResult,
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
} from "./playback-skip";
import { createPlaybackWatchdog, type PlaybackWatchdog } from "./playback-watchdog";
import type { ActivePlayerControl } from "./PlayerControlService";
import type { LateSubtitleAttachment, PlayerPlaybackEvent } from "./PlayerService";

type MpvProcess = {
  readonly exited: Promise<number>;
  readonly killed: boolean;
  readonly exitCode: number | null;
  kill(signal?: string | number): void;
};

type PlayerCycleOptions = {
  displayTitle: string;
  primarySubtitle: string | null;
  subtitleTracks?: readonly SubtitleTrack[];
  startAt?: number;
  timing?: PlaybackTimingMetadata | null;
  skipRecap?: boolean;
  skipIntro?: boolean;
  skipPreview?: boolean;
  skipCredits?: boolean;
  autoNextEnabled?: boolean;
  onPlayerReady?: () => void;
  onPlaybackEvent?: (event: PlayerPlaybackEvent) => void;
  /** Called when the user presses N or P inside the mpv window. The mpv process
   *  handles the stop itself; the app only needs to record the intent. */
  onMpvActionRequest?: (action: "next" | "previous") => void;
  /** Called once when playback position is within ~30 s of the end. */
  onNearEof?: () => void;
};

type PlayerCycleState = {
  telemetry: PlayerTelemetryState;
  resolve: (result: PlaybackResult) => void;
  promise: Promise<PlaybackResult>;
  playerReadyNotified: boolean;
  playerStartedNotified: boolean;
  onPlayerReady?: () => void;
  onPlaybackEvent?: (event: PlayerPlaybackEvent) => void;
};

export class PersistentMpvSession {
  private readonly id = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
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

  private constructor(
    private readonly initialStream: StreamInfo,
    private readonly initialOptions: PlayerCycleOptions,
    private readonly onControlReady: (control: ActivePlayerControl | null) => void,
  ) {
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
      showOsdMessage: async (text, durationMs) => {
        await this.ipcSession?.send(["show-text", text, durationMs], 1_000);
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

    this.currentHeadersKey = this.buildHeadersKey(stream.headers ?? {});
    const cycle = this.beginCycle(options);
    this.resetCycleState();
    options.onPlaybackEvent?.({ type: "opening-stream" });

    if (!this.hasLoadedFile) {
      this.hasLoadedFile = true;
      this.queueReadyWork(options);
      return await cycle.promise;
    }

    await this.removeExternalSubtitles();
    options.onPlaybackEvent?.({ type: "resolving-playback" });
    this.queueReadyWork(options);
    const loadResult = await this.ipcSession?.send(["loadfile", stream.url, "replace"], 3_000);
    if (!loadResult?.ok) {
      options.onPlaybackEvent?.({
        type: "ipc-command-failed",
        command: "loadfile",
        error: loadResult?.error ?? "ipc unavailable",
      });
    }
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

    const args = buildMpvArgs(
      {
        url: this.initialStream.url,
        headers: this.initialStream.headers ?? {},
        subtitle: this.initialOptions.primarySubtitle,
        subtitleTracks: this.initialOptions.subtitleTracks,
        displayTitle: this.initialOptions.displayTitle,
        startAt: this.initialOptions.startAt,
      },
      ipcServerCliArg(this.ipcEndpoint),
      {
        persistent: true,
        includeStartArg: false,
        mpv: mpvOptions,
        scriptPath: this.luaScriptPath ?? undefined,
        scriptOpts: this.scriptOptsArg,
      },
    );

    const emitPlaybackEvent = (event: PlayerPlaybackEvent) =>
      this.currentCycleOptions().onPlaybackEvent?.(event);
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
      const ready = await waitForMpvIpcEndpoint(this.ipcEndpoint, 5_000);
      if (!ready) {
        this.currentCycleOptions().onPlaybackEvent?.({
          type: "ipc-command-failed",
          command: "ipc-bootstrap",
          error: `IPC endpoint was not ready at ${ipcServerCliArg(this.ipcEndpoint)}`,
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
              if (req === "next" || req === "previous") {
                this.currentCycleOptions().onMpvActionRequest?.(req);
                void this.ipcSession?.send(["set_property", "user-data/kunai-request", ""], 500);
              } else if (req === "skip" || req === "auto-skip") {
                const automatic = req === "auto-skip";
                void this.onSkipRequestFromMpv(automatic);
                void this.ipcSession?.send(["set_property", "user-data/kunai-request", ""], 500);
              }
              return;
            }

            if (!active) return;
            applyObservedPropertySample(active.telemetry, { name, value, observedAt });
            if (active.telemetry.latestIpcSample) {
              this.watchdog?.observe(active.telemetry.latestIpcSample);
            }
            if (name === "track-list") {
              this.lastTrackList = value;
            }
            if ((name === "time-pos" || name === "playback-time") && typeof value === "number") {
              this.currentPositionSeconds = value;
              if (value > 0 && !active.playerStartedNotified) {
                active.playerStartedNotified = true;
                active.onPlaybackEvent?.({ type: "playback-started" });
              }
              void this.handleSegmentSkipProgress(this.currentCycleOptions());

              // Near-EOF detection for prefetch — fire once per cycle when within 30s of end.
              if (!this.nearEofFired) {
                const duration = active.telemetry.latestIpcSample?.durationSeconds ?? 0;
                if (duration > 30 && duration - value < 30) {
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
            const active = this.activeCycle;
            if (!active) return;
            this.clearReadyWorkFallback();
            this.pendingReadyWork = null;
            // Fire onNearEof if it was never triggered (e.g. no duration reported).
            // This gives the prefetch a chance to start even if it will be late.
            if (!this.nearEofFired) {
              this.nearEofFired = true;
              this.currentCycleOptions().onNearEof?.();
            }
            applyEndFileEvent(active.telemetry, reason, observedAt);
            const result = finalizePlaybackResult(active.telemetry, {
              socketPathCleanedUp: false,
            });
            this.activeCycle = null;
            active.resolve(result);
          },
          onFileLoaded: () => {
            const pending = this.pendingReadyWork;
            if (!pending) return;
            this.pendingReadyWork = null;
            this.clearReadyWorkFallback();
            void this.runReadyWork(pending);
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
        this.currentCycleOptions().onPlaybackEvent?.({
          type: "ipc-command-failed",
          command: "ipc-bootstrap",
          error: error instanceof Error ? error.message : String(error),
        });
        proc.kill("SIGTERM");
        await this.handleProcessTermination({ code: 1, signal: null });
        return;
      }

      this.currentCycleOptions().onPlaybackEvent?.({ type: "ipc-connected" });
      this.currentCycleOptions().onPlaybackEvent?.({ type: "opening-stream" });

      // Observe user-data properties written by the kunai Lua script so that
      // key presses inside the mpv window are routed back to the app.
      void this.ipcSession.send(["observe_property", 200, "user-data/kunai-request"], 1_000);
    }
    this.queueReadyWork(this.initialOptions);
  }

  private beginCycle(options: PlayerCycleOptions): PlayerCycleState {
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
    };
    this.activeCycle = cycle;
    this.currentOptions = options;
    return cycle;
  }

  private resetCycleState(): void {
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

  private queueReadyWork(options: PlayerCycleOptions): void {
    this.pendingReadyWork = options;
    if (this.readyWorkFallbackTimer) {
      this.clearReadyWorkFallback();
    }
    if (!this.ipcSession) {
      void this.runReadyWork(options);
      return;
    }
    this.readyWorkFallbackTimer = setTimeout(() => {
      if (this.pendingReadyWork !== options) return;
      this.pendingReadyWork = null;
      this.readyWorkFallbackTimer = null;
      void this.runReadyWork(options);
    }, 750);
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

    this.resumeSeekPending = shouldApplyStartAtSeek(options.startAt);
    try {
      // Ensure playback is not paused when a new file loads. With --keep-open=no this is
      // normally a no-op, but guards against pause=yes persisting from a previous cycle
      // (e.g. user paused mid-episode then pressed N, or a keep-open edge case).
      await this.ipcSession.send(["set_property", "pause", false], 500);

      // Always push the display title for this episode so the mpv window title and
      // OSD stay correct across persistent-session episode transitions.
      await this.ipcSession.send(
        ["set_property", "force-media-title", options.displayTitle],
        1_000,
      );

      if (shouldApplyStartAtSeek(options.startAt)) {
        options.onPlaybackEvent?.({ type: "resolving-playback" });
        const seekResult = await this.ipcSession.send(
          ["seek", options.startAt!, "absolute"],
          2_000,
        );
        // IPC time-pos may lag behind the seek; autoskip uses currentPositionSeconds — sync so
        // recap/intro windows are evaluated from the resume point, not from 0 (which would
        // incorrectly skip earlier segments after a mid-episode resume).
        if (seekResult.ok) {
          this.currentPositionSeconds = options.startAt!;
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
      const result = await this.ipcSession.send(["sub-add", primarySubtitle, "select"]);
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
    if (primarySubtitle || additionalTracks.length > 0) {
      onAttached?.(additionalTracks.length);
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
      const result = await this.ipcSession.send(["sub-add", attachment.primarySubtitle, "select"]);
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
      skipRecap: options.skipRecap ?? true,
      skipIntro: options.skipIntro ?? true,
      skipPreview: options.skipPreview ?? true,
      skipCredits: options.skipCredits ?? true,
      autoNextEnabled: options.autoNextEnabled ?? false,
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
    this.skippedSegments.add(segment.key);
    this.clearSkipPromptState();
    await this.ipcSession.send(["seek", segment.endSeconds, "absolute"], 1_000);
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

  private async onSkipRequestFromMpv(automatic: boolean): Promise<void> {
    const options = this.currentCycleOptions();
    if (!this.ipcSession) return;
    const segment = findPlaybackSegmentAtPosition(options.timing, this.currentPositionSeconds);
    if (!segment || this.skippedSegments.has(segment.key)) return;
    this.clearSkipAutoTimer();
    await this.performSeekSkip(options, segment, automatic);
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
