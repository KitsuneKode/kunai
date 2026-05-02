import { spawn, type ChildProcess } from "child_process";
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
import type { ActivePlayerControl } from "./PlayerControlService";
import type { PlayerPlaybackEvent } from "./PlayerService";
import type { MpvIpcSession } from "./mpv-ipc";
import { openMpvIpcSession, waitForMpvIpcSocket } from "./mpv-ipc";
import { findActivePlaybackSkip, type PlaybackSkipConfig } from "./playback-skip";
import { createPlaybackWatchdog, type PlaybackWatchdog } from "./playback-watchdog";
import {
  applyEndFileEvent,
  applyObservedPropertySample,
  createPlayerTelemetryState,
  finalizePlaybackResult,
  recordPlayerExit,
  type PlayerTelemetryState,
} from "./mpv-telemetry";

type PlayerCycleOptions = {
  displayTitle: string;
  primarySubtitle: string | null;
  subtitleTracks?: readonly SubtitleTrack[];
  startAt?: number;
  timing?: PlaybackTimingMetadata | null;
  skipRecap?: boolean;
  skipIntro?: boolean;
  skipPreview?: boolean;
  onPlayerReady?: () => void;
  onPlaybackEvent?: (event: PlayerPlaybackEvent) => void;
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
  private mpv: ChildProcess | null = null;
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
          await this.ipcSession.send(["quit"], 1_000);
          return;
        }
        this.mpv?.kill("SIGTERM");
      },
      stopCurrentFile: async () => {
        await this.ipcSession?.send(["stop"], 1_000);
      },
      reloadSubtitles: async () => {
        await this.reloadSubtitles();
      },
      skipCurrentSegment: async () => this.skipCurrentSegment(),
    };
  }

  static async create(opts: {
    stream: StreamInfo;
    options: PlayerCycleOptions;
    onControlReady: (control: ActivePlayerControl | null) => void;
  }): Promise<PersistentMpvSession> {
    const session = new PersistentMpvSession(opts.stream, opts.options, opts.onControlReady);
    await session.spawn();
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

  getControl(): ActivePlayerControl {
    return this.currentControl;
  }

  waitForCurrentPlayback(): Promise<PlaybackResult> {
    if (!this.activeCycle) {
      throw new Error("Persistent MPV session has no active playback");
    }
    return this.activeCycle.promise;
  }

  async close(): Promise<void> {
    if (!this.alive) {
      await this.cleanupSocket();
      this.onControlReady(null);
      return;
    }

    this.currentCycleOptions().onPlaybackEvent?.({ type: "player-closing" });
    this.clearReadyWorkFallback();
    if (this.ipcSession) {
      await this.ipcSession.send(["quit"], 1_000);
    } else {
      this.mpv?.kill("SIGTERM");
    }

    await new Promise<void>((resolve) => {
      const target = this.mpv;
      if (!target) return resolve();
      target.once("close", () => resolve());
      setTimeout(resolve, 1500);
    });
    this.watchdog?.stop();
    this.watchdog = null;
    await this.ipcSession?.close().catch(() => {});
    this.ipcSession = null;
    await this.cleanupSocket();
    this.onControlReady(null);
  }

  private async spawn(): Promise<void> {
    if (this.ipcPath) {
      await unlinkIfExists(this.ipcPath);
    }

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
      this.ipcPath,
      { persistent: true, includeStartArg: false },
    );

    const emitPlaybackEvent = (event: PlayerPlaybackEvent) =>
      this.currentCycleOptions().onPlaybackEvent?.(event);
    this.watchdog = createPlaybackWatchdog(emitPlaybackEvent);

    this.mpv = spawn("mpv", args, {
      detached: false,
      stdio: ["ignore", "ignore", "ignore"],
      env: process.env as Record<string, string>,
    });
    this.alive = true;
    this.initialOptions.onPlaybackEvent?.({ type: "mpv-process-started" });
    this.hasLoadedFile = true;
    this.resetCycleState();
    this.onControlReady(this.currentControl);

    this.mpv.once("close", async (code, signal) => {
      this.alive = false;
      this.clearReadyWorkFallback();
      this.watchdog?.stop();
      this.watchdog = null;
      const active = this.activeCycle;
      if (active) {
        recordPlayerExit(active.telemetry, { code, signal });
        const result = finalizePlaybackResult(active.telemetry, {
          socketPathCleanedUp: this.ipcPath ? !existsSync(this.ipcPath) : true,
        });
        this.activeCycle = null;
        active.resolve(result);
      }
      await this.cleanupSocket();
      this.currentCycleOptions().onPlaybackEvent?.({ type: "player-closed" });
      this.onControlReady(null);
    });
    this.mpv.once("error", async () => {
      this.alive = false;
      this.clearReadyWorkFallback();
      this.watchdog?.stop();
      this.watchdog = null;
      const active = this.activeCycle;
      if (active) {
        recordPlayerExit(active.telemetry, { code: 1, signal: null });
        const result = finalizePlaybackResult(active.telemetry, {
          socketPathCleanedUp: this.ipcPath ? !existsSync(this.ipcPath) : true,
        });
        this.activeCycle = null;
        active.resolve(result);
      }
      await this.cleanupSocket();
      this.currentCycleOptions().onPlaybackEvent?.({ type: "player-closed" });
      this.onControlReady(null);
    });

    if (this.ipcPath) {
      const ready = await waitForMpvIpcSocket(this.ipcPath, 5_000);
      if (ready) {
        this.ipcSession = await openMpvIpcSession({
          socketPath: this.ipcPath,
          onPropertyUpdate: ({ name, value, observedAt }) => {
            const active = this.activeCycle;
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
        this.currentCycleOptions().onPlaybackEvent?.({ type: "ipc-connected" });
        this.currentCycleOptions().onPlaybackEvent?.({ type: "opening-stream" });
      }
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
    if (additionalTracks.length > 0) {
      onAttached?.(additionalTracks.length);
    }
  }

  private async reloadSubtitles(): Promise<void> {
    const active = this.activeCycle;
    if (!active || !this.ipcSession) return;
    await this.ipcSession.send(["sub-reload"], 1_000);
  }

  private currentCycleOptions(): PlayerCycleOptions {
    return this.currentOptions;
  }

  private skipConfig(options: PlayerCycleOptions): PlaybackSkipConfig {
    return {
      skipRecap: options.skipRecap ?? true,
      skipIntro: options.skipIntro ?? true,
      skipPreview: options.skipPreview ?? true,
    };
  }

  private async maybeAutoSkip(options: PlayerCycleOptions, automatic: boolean): Promise<boolean> {
    const activeSkip = findActivePlaybackSkip(
      options.timing,
      this.currentPositionSeconds,
      this.skipConfig(options),
    );
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

  private async cleanupSocket(): Promise<void> {
    if (!this.ipcPath || !existsSync(this.ipcPath)) return;
    await unlink(this.ipcPath).catch(() => {});
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
