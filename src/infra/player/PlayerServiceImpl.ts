// =============================================================================
// Player Service Implementation
//
// Delegates to the existing mpv.ts for media playback.
// =============================================================================

import type { PlayerService, PlayerOptions } from "./PlayerService";
import type { PlaybackResult } from "../../domain/types";
import type { Logger } from "../logger/Logger";
import type { Tracer } from "../tracer/Tracer";
import { launchMpv } from "../../mpv";

export class PlayerServiceImpl implements PlayerService {
  constructor(
    private deps: {
      logger: Logger;
      tracer: Tracer;
    },
  ) {}

  async play(
    stream: import("../../domain/types").StreamInfo,
    options: PlayerOptions,
  ): Promise<PlaybackResult> {
    this.deps.logger.info("Launching MPV", {
      title: options.displayTitle,
      url: stream.url,
      startAt: options.startAt,
    });

    try {
      const result = await launchMpv({
        url: stream.url,
        headers: stream.headers ?? {},
        subtitle: stream.subtitle ?? null,
        displayTitle: options.displayTitle,
        startAt: options.startAt,
        autoNext: options.autoNext,
        attach: options.attach,
      });

      this.deps.logger.info("MPV playback complete", {
        watchedSeconds: result.watchedSeconds,
        duration: result.duration,
        endReason: result.endReason,
      });

      return result;
    } catch (e) {
      this.deps.logger.error("MPV playback failed", { error: String(e) });
      return {
        watchedSeconds: 0,
        duration: 0,
        endReason: "error",
      };
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { spawn } = await import("child_process");
      const mpv = spawn("mpv", ["--version"], { stdio: "ignore" });
      return new Promise((resolve) => {
        mpv.on("error", () => resolve(false));
        mpv.on("close", (code) => resolve(code === 0));
      });
    } catch {
      return false;
    }
  }
}
