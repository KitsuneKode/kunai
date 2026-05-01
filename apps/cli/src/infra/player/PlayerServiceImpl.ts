// =============================================================================
// Player Service Implementation
//
// Delegates to the existing mpv.ts for media playback.
// =============================================================================

import type { PlayerService, PlayerOptions } from "./PlayerService";
import type { PlaybackResult, StreamInfo } from "@/domain/types";
import type { Logger } from "@/infra/logger/Logger";
import type { Tracer } from "@/infra/tracer/Tracer";
import type { DiagnosticsStore } from "@/services/diagnostics/DiagnosticsStore";
import { launchMpv } from "@/mpv";
import type { PlayerControlService } from "./PlayerControlService";

export class PlayerServiceImpl implements PlayerService {
  constructor(
    private deps: {
      logger: Logger;
      tracer: Tracer;
      diagnosticsStore: DiagnosticsStore;
      playerControl: PlayerControlService;
    },
  ) {}

  async play(stream: StreamInfo, options: PlayerOptions): Promise<PlaybackResult> {
    process.stderr.write(`Starting playback: ${options.displayTitle}\n`);
    process.stderr.write(
      stream.subtitle
        ? `Subtitle attached: ${stream.subtitle}\n`
        : `${options.subtitleStatus ?? "Subtitles not attached"}; playback will start without a subtitle file.\n`,
    );

    this.deps.logger.info("Launching MPV", {
      title: options.displayTitle,
      url: stream.url,
      startAt: options.startAt,
    });
    this.deps.diagnosticsStore.record({
      category: "playback",
      message: "Launching MPV",
      context: {
        title: options.displayTitle,
        hasSubtitle: Boolean(stream.subtitle),
        subtitleUrl: stream.subtitle ?? null,
        subtitleStatus: options.subtitleStatus ?? null,
        startAt: options.startAt ?? 0,
      },
    });

    try {
      const result = await launchMpv({
        url: stream.url,
        headers: stream.headers ?? {},
        subtitle: stream.subtitle ?? null,
        subtitleUrls: stream.subtitleList?.map((t) => t.url),
        displayTitle: options.displayTitle,
        startAt: options.startAt,
        attach: options.attach,
        onControlReady: (control) => this.deps.playerControl.setActive(control),
        onPlayerReady: options.onPlayerReady,
      });

      this.deps.logger.info("MPV playback complete", {
        watchedSeconds: result.watchedSeconds,
        duration: result.duration,
        endReason: result.endReason,
        resultSource: result.resultSource ?? "unknown",
        playerExitedCleanly: result.playerExitedCleanly ?? false,
        playerExitCode: result.playerExitCode ?? null,
        playerExitSignal: result.playerExitSignal ?? null,
        lastNonZeroPositionSeconds: result.lastNonZeroPositionSeconds ?? 0,
        lastNonZeroDurationSeconds: result.lastNonZeroDurationSeconds ?? 0,
      });
      this.deps.diagnosticsStore.record({
        category: "playback",
        message: "MPV playback complete",
        context: {
          watchedSeconds: result.watchedSeconds,
          duration: result.duration,
          endReason: result.endReason,
          resultSource: result.resultSource ?? "unknown",
          playerExitedCleanly: result.playerExitedCleanly ?? false,
          playerExitCode: result.playerExitCode ?? null,
          playerExitSignal: result.playerExitSignal ?? null,
          socketPathCleanedUp: result.socketPathCleanedUp ?? true,
          lastNonZeroPositionSeconds: result.lastNonZeroPositionSeconds ?? 0,
          lastNonZeroDurationSeconds: result.lastNonZeroDurationSeconds ?? 0,
        },
      });

      return result;
    } catch (e) {
      this.deps.logger.error("MPV playback failed", { error: String(e) });
      this.deps.diagnosticsStore.record({
        category: "playback",
        message: "MPV playback failed",
        context: { error: String(e) },
      });
      return {
        watchedSeconds: 0,
        duration: 0,
        endReason: "error",
        resultSource: "unknown",
        playerExitedCleanly: false,
        playerExitCode: 1,
        playerExitSignal: null,
        socketPathCleanedUp: true,
        lastNonZeroPositionSeconds: 0,
        lastNonZeroDurationSeconds: 0,
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
