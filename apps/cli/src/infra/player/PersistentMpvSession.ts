import { existsSync } from "fs";
import { unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import type {
  PlaybackResult,
  PlaybackTimingMetadata,
  StreamInfo,
  SubtitleTrack,
} from "@/domain/types";
import { buildMpvArgs, collectAdditionalSubtitleTracks } from "@/mpv";

import type { MpvIpcSession } from "./mpv-ipc";
import { openMpvIpcSession, waitForMpvIpcSocket } from "./mpv-ipc";
import type { MpvRuntimeOptions } from "./mpv-runtime-options";
import {
  applyEndFileEvent,
  applyObservedPropertySample,
  createPlayerTelemetryState,
  finalizePlaybackResult,
  recordPlayerExit,
  type PlayerTelemetryState,
} from "./mpv-telemetry";
import { findActivePlaybackSkip, type PlaybackSkipConfig } from "./playback-skip";
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
  private readonly ipcPath =
    process.platform === "win32" ? null : join(tmpdir(), `kunai-mpv-${this.id}.sock`);
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
    onControlReady: (control: ActivePlayerControl | null) => void;
  }): Promise<PersistentMpvSession> {
    const session = new PersistentMpvSession(opts.stream, opts.options, opts.onControlReady);
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
    void this.maybeAutoSkip(this.currentOptions, true);
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
    if (this.ipcPath) {
      await unlinkIfExists(this.ipcPath);
    }

    this.terminationPromise = null;
    this.terminated = false;
    this.beginCycle(this.initialOptions);
    this.initialOptions.onPlaybackEvent?.({ type: "launching-player" });

    this.luaScriptPath = await writeLuaScript(this.id);

    const args = buildMpvArgs(
      {
        url: this.initialStream.url,
        headers: this.initialStream.headers ?? {},
        subtitle: this.initialOptions.primarySubtitle,
        subtitleTracks: this.initialOptions.subtitleTracks,
        displayTitle: this.initialOptions.displayTitle,
        startAt: this.initialOptions.startAt,
      },
      this.ipcPath,
      {
        persistent: true,
        includeStartArg: false,
        mpv: mpvOptions,
        scriptPath: this.luaScriptPath ?? undefined,
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
    });

    if (this.ipcPath) {
      const ready = await waitForMpvIpcSocket(this.ipcPath, 5_000);
      if (!ready) {
        this.currentCycleOptions().onPlaybackEvent?.({
          type: "ipc-command-failed",
          command: "ipc-bootstrap",
          error: `IPC socket was not ready at ${this.ipcPath}`,
        });
        proc.kill("SIGTERM");
        await this.handleProcessTermination({ code: 1, signal: null });
        return;
      }

      try {
        this.ipcSession = await openMpvIpcSession({
          socketPath: this.ipcPath,
          onPropertyUpdate: ({ name, value, observedAt }) => {
            const active = this.activeCycle;

            // user-data/kunai-request is written by the Lua script when the user
            // presses N/P inside mpv. Handle it regardless of activeCycle state.
            if (name === "user-data/kunai-request") {
              const req = typeof value === "string" ? value : null;
              if (req === "next" || req === "previous") {
                this.currentCycleOptions().onMpvActionRequest?.(req);
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
              void this.maybeAutoSkip(this.currentCycleOptions(), true);

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
    const telemetry = createPlayerTelemetryState(this.ipcPath ?? undefined);
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

    // Always push the display title for this episode so the mpv window title and
    // OSD stay correct across persistent-session episode transitions.
    await this.ipcSession.send(["set_property", "force-media-title", options.displayTitle], 1_000);

    if (options.startAt && options.startAt > 5) {
      options.onPlaybackEvent?.({ type: "resolving-playback" });
      await this.ipcSession.send(["seek", options.startAt, "absolute"], 2_000);
    }

    await this.replaceSubtitleInventory(
      options.primarySubtitle,
      options.subtitleTracks,
      (trackCount) => {
        options.onPlaybackEvent?.({ type: "subtitle-inventory-ready", trackCount });
        options.onPlaybackEvent?.({ type: "subtitle-attached", trackCount });
      },
    );
    await this.maybeAutoSkip(options, true);
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

  private async maybeAutoSkip(options: PlayerCycleOptions, automatic: boolean): Promise<boolean> {
    const activeSkip = findActivePlaybackSkip(
      options.timing,
      this.currentPositionSeconds,
      this.skipConfig(options),
    );

    // Keep user-data/kunai-skip-to in sync so the Lua I-key binding can seek
    // without a round-trip through the app.
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
    options.onPlaybackEvent?.({ type: "segment-skipped", kind: activeSkip.kind, automatic });
    return true;
  }

  private async skipCurrentSegment(): Promise<boolean> {
    return await this.maybeAutoSkip(this.currentCycleOptions(), false);
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
          socketPathCleanedUp: this.ipcPath ? !existsSync(this.ipcPath) : true,
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
    if (!this.ipcPath || !existsSync(this.ipcPath)) return;
    await unlink(this.ipcPath).catch(() => {});
  }

  private async cleanupLuaScript(): Promise<void> {
    if (!this.luaScriptPath) return;
    const path = this.luaScriptPath;
    this.luaScriptPath = null;
    if (existsSync(path)) await unlink(path).catch(() => {});
  }
}

async function writeLuaScript(id: string): Promise<string | null> {
  if (process.platform === "win32") return null;
  const path = join(tmpdir(), `kunai-mpv-keys-${id}.lua`);
  const content = `
-- kunai mpv keybinding bridge
-- Sets user-data properties that the app observes via IPC.
-- N / n  → next episode    P / p → previous episode
-- I / i  → skip segment (position written to user-data/kunai-skip-to by app)

local function signal(action)
  mp.set_property("user-data/kunai-request", action)
end

local function do_next()
  signal("next")
  mp.commandv("stop")
end

local function do_previous()
  signal("previous")
  mp.commandv("stop")
end

local function do_skip()
  local skip_to = mp.get_property_number("user-data/kunai-skip-to", -1)
  if skip_to and skip_to > 0 then
    mp.commandv("seek", tostring(skip_to), "absolute")
    mp.osd_message("Skipped", 1)
  end
end

mp.add_key_binding("n", "kunai-next",           do_next,     {repeatable=false})
mp.add_key_binding("N", "kunai-next-shift",     do_next,     {repeatable=false})
mp.add_key_binding("p", "kunai-prev",           do_previous, {repeatable=false})
mp.add_key_binding("P", "kunai-prev-shift",     do_previous, {repeatable=false})
mp.add_key_binding("i", "kunai-skip",           do_skip,     {repeatable=false})
mp.add_key_binding("I", "kunai-skip-shift",     do_skip,     {repeatable=false})
`;
  await Bun.write(path, content);
  return path;
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
