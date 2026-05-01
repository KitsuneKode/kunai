import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import type { PlaybackResult, StreamInfo, SubtitleTrack } from "@/domain/types";
import { buildMpvArgs, collectAdditionalSubtitleTracks } from "@/mpv";
import type { ActivePlayerControl } from "./PlayerControlService";
import type { MpvIpcSession } from "./mpv-ipc";
import { openMpvIpcSession, waitForMpvIpcSocket } from "./mpv-ipc";
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
  onPlayerReady?: () => void;
};

type PlayerCycleState = {
  telemetry: PlayerTelemetryState;
  resolve: (result: PlaybackResult) => void;
  promise: Promise<PlaybackResult>;
  playerReadyNotified: boolean;
  onPlayerReady?: () => void;
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

  private constructor(
    private readonly initialStream: StreamInfo,
    private readonly initialOptions: PlayerCycleOptions,
    private readonly onControlReady: (control: ActivePlayerControl | null) => void,
  ) {
    this.currentHeadersKey = this.buildHeadersKey(initialStream.headers ?? {});
    this.currentControl = {
      id: this.id,
      stop: async () => {
        if (this.ipcSession) {
          this.ipcSession.send(["quit"]);
          return;
        }
        this.mpv?.kill("SIGTERM");
      },
      stopCurrentFile: async () => {
        this.ipcSession?.send(["stop"]);
      },
      reloadSubtitles: async () => {
        await this.reloadSubtitles();
      },
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

    if (!this.hasLoadedFile) {
      this.hasLoadedFile = true;
      this.scheduleReadyWork(options);
      return await cycle.promise;
    }

    await this.removeExternalSubtitles();
    this.ipcSession?.send(["loadfile", stream.url, "replace"]);
    this.scheduleReadyWork(options);
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

    if (this.ipcSession) {
      this.ipcSession.send(["quit"]);
    } else {
      this.mpv?.kill("SIGTERM");
    }

    await new Promise<void>((resolve) => {
      const target = this.mpv;
      if (!target) return resolve();
      target.once("close", () => resolve());
      setTimeout(resolve, 1500).unref?.();
    });
    await this.cleanupSocket();
    this.onControlReady(null);
  }

  private async spawn(): Promise<void> {
    if (this.ipcPath) {
      await unlinkIfExists(this.ipcPath);
    }

    this.beginCycle(this.initialOptions);
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
      { persistent: true },
    );

    this.mpv = spawn("mpv", args, {
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
      env: process.env as Record<string, string>,
    });
    this.alive = true;
    this.hasLoadedFile = true;
    this.onControlReady(this.currentControl);

    this.mpv.once("close", async (code, signal) => {
      this.alive = false;
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
      this.onControlReady(null);
    });
    this.mpv.once("error", async () => {
      this.alive = false;
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
            if (name === "track-list") {
              this.lastTrackList = value;
            }
            if (
              !active.playerReadyNotified &&
              (name === "filename" ||
                name === "media-title" ||
                (name === "playback-time" && typeof value === "number" && value >= 0))
            ) {
              active.playerReadyNotified = true;
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
        });
      }
    }
    this.scheduleReadyWork(this.initialOptions);
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
    };
    this.activeCycle = cycle;
    return cycle;
  }

  private scheduleReadyWork(options: PlayerCycleOptions): void {
    const cycle = this.activeCycle;
    if (!cycle) return;

    const run = async () => {
      if (!cycle.playerReadyNotified) {
        cycle.playerReadyNotified = true;
        cycle.onPlayerReady?.();
      }

      if (!this.ipcSession) return;
      if (options.startAt && options.startAt > 5) {
        this.ipcSession.send(["seek", options.startAt, "absolute"]);
      }

      await this.replaceSubtitleInventory(options.primarySubtitle, options.subtitleTracks);
    };

    setTimeout(() => {
      void run();
    }, 250).unref?.();
  }

  private async replaceSubtitleInventory(
    primarySubtitle: string | null,
    subtitleTracks?: readonly SubtitleTrack[],
  ): Promise<void> {
    if (!this.ipcSession) return;

    await this.removeExternalSubtitles();

    if (primarySubtitle) {
      this.ipcSession.send(["sub-add", primarySubtitle, "select"]);
    }

    for (const track of collectAdditionalSubtitleTracks(primarySubtitle, subtitleTracks)) {
      this.ipcSession.send([
        "sub-add",
        track.url,
        "auto",
        track.display ?? "",
        track.language ?? "",
      ]);
    }
  }

  private async reloadSubtitles(): Promise<void> {
    const active = this.activeCycle;
    if (!active || !this.ipcSession) return;
    this.ipcSession.send(["sub-reload"]);
  }

  private async removeExternalSubtitles(): Promise<void> {
    if (!this.ipcSession) return;

    for (const trackId of extractExternalSubtitleIds(this.lastTrackList)) {
      this.ipcSession.send(["sub-remove", trackId]);
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
