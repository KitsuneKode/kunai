// =============================================================================
// Player Service Implementation
//
// Delegates to the existing mpv.ts for media playback.
// =============================================================================

import type { PlaybackResult, StreamInfo } from "@/domain/types";
import type { Logger } from "@/infra/logger/Logger";
import type { Tracer } from "@/infra/tracer/Tracer";
import { launchMpv, shouldApplyStartAtSeek } from "@/mpv";
import type { DiagnosticsStore } from "@/services/diagnostics/DiagnosticsStore";
import type { ConfigService } from "@/services/persistence/ConfigService";
import { formatTimestamp } from "@/services/persistence/HistoryStore";

import type { MpvRuntimeOptions } from "./mpv-runtime-options";
import { PersistentMpvSession } from "./PersistentMpvSession";
import {
  classifyPlaybackFailureFromEvent,
  classifyPlaybackFailureFromResult,
  recoveryForPlaybackFailure,
} from "./playback-failure-classifier";
import type { PlayerControlService } from "./PlayerControlService";
import type { PlayerOptions, PlayerPlaybackEvent, PlayerService } from "./PlayerService";

export class PlayerServiceImpl implements PlayerService {
  private persistentSession: PersistentMpvSession | null = null;

  constructor(
    private deps: {
      logger: Logger;
      tracer: Tracer;
      diagnosticsStore: DiagnosticsStore;
      playerControl: PlayerControlService;
      config: ConfigService;
      mpv?: MpvRuntimeOptions;
    },
  ) {}

  async play(stream: StreamInfo, options: PlayerOptions): Promise<PlaybackResult> {
    options.onPlaybackEvent?.({ type: "launching-player" });
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
      resumePromptAt: options.resumePromptAt ?? 0,
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
        resumePromptAt: options.resumePromptAt ?? 0,
      },
    });

    try {
      const result =
        options.playbackMode === "autoplay-chain"
          ? await this.playAutoplayChainStream(stream, options)
          : await this.playOneShotStream(stream, options);

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
        lastTrustedProgressSeconds: result.lastTrustedProgressSeconds ?? 0,
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
          lastTrustedProgressSeconds: result.lastTrustedProgressSeconds ?? 0,
          failureClass: classifyPlaybackFailureFromResult(result),
          recovery: recoveryForPlaybackFailure(classifyPlaybackFailureFromResult(result)),
        },
      });

      return result;
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      const actionableHint = errorMessage.toLowerCase().includes("mpv")
        ? "mpv is required for playback. Install mpv and retry."
        : "Run / export-diagnostics and / report-issue if this keeps failing.";
      this.deps.logger.error("MPV playback failed", { error: String(e) });
      this.deps.diagnosticsStore.record({
        category: "playback",
        message: "MPV playback failed",
        context: { error: errorMessage, hint: actionableHint },
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

  async releasePersistentSession(): Promise<void> {
    if (!this.persistentSession) return;
    await this.persistentSession.close();
    this.persistentSession = null;
    this.deps.playerControl.setActive(null);
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(Bun.which("mpv"));
  }

  private async playOneShotStream(
    stream: StreamInfo,
    options: PlayerOptions,
  ): Promise<PlaybackResult> {
    await this.releasePersistentSession();
    return await launchMpv({
      url: stream.url,
      headers: stream.headers ?? {},
      subtitle: stream.subtitle ?? null,
      subtitleTracks: stream.subtitleList,
      displayTitle: options.displayTitle,
      startAt: options.startAt,
      attach: options.attach,
      timing: options.timing,
      skipRecap: options.skipRecap,
      skipIntro: options.skipIntro,
      skipPreview: options.skipPreview,
      skipCredits: options.skipCredits,
      onControlReady: (control) => this.deps.playerControl.setActive(control),
      onPlayerReady: options.onPlayerReady,
      onPlaybackEvent: this.wrapPlaybackEventHandler(options.onPlaybackEvent),
      mpv: this.deps.mpv,
    });
  }

  private async playAutoplayChainStream(
    stream: StreamInfo,
    options: PlayerOptions,
  ): Promise<PlaybackResult> {
    if (this.persistentSession && !this.persistentSession.isReusable()) {
      await this.releasePersistentSession();
    }

    if (this.persistentSession && !this.persistentSession.matchesHeaders(stream.headers ?? {})) {
      await this.releasePersistentSession();
    }

    const resumePromptAt = options.resumePromptAt ?? 0;
    const offerResumeStartChoice =
      shouldApplyStartAtSeek(resumePromptAt) && options.resumeStartChoicePrompt !== false;

    const sharedOptions = {
      displayTitle: options.displayTitle,
      primarySubtitle: stream.subtitle ?? null,
      subtitleTracks: stream.subtitleList,
      startAt: options.startAt,
      resumePromptAt,
      offerResumeStartChoice,
      resumeChoiceTimeLabel:
        offerResumeStartChoice && typeof resumePromptAt === "number"
          ? formatTimestamp(Math.floor(resumePromptAt))
          : undefined,
      timing: options.timing,
      skipRecap: options.skipRecap,
      skipIntro: options.skipIntro,
      skipPreview: options.skipPreview,
      skipCredits: options.skipCredits,
      autoNextEnabled: true,
      onPlayerReady: options.onPlayerReady,
      onPlaybackEvent: this.wrapPlaybackEventHandler(options.onPlaybackEvent),
      onMpvActionRequest: (action: "next" | "previous" | "pick-quality" | "refresh") => {
        this.deps.playerControl.signalPlaybackAction(action);
      },
      onNearEof: options.onNearEof,
    };

    if (!this.persistentSession) {
      this.persistentSession = await PersistentMpvSession.create({
        stream,
        options: sharedOptions,
        mpv: this.deps.mpv,
        kitsuneConfig: this.deps.config.getRaw(),
        onControlReady: (control) => this.deps.playerControl.setActive(control),
      });
      const result = await this.persistentSession.waitForCurrentPlayback();
      if (this.persistentSession && !this.persistentSession.isReusable()) {
        await this.releasePersistentSession();
      }
      return result;
    }

    const result = await this.persistentSession.play(stream, sharedOptions);

    if (this.persistentSession && !this.persistentSession.isReusable()) {
      await this.releasePersistentSession();
    }

    return result;
  }

  private wrapPlaybackEventHandler(
    handler: ((event: PlayerPlaybackEvent) => void) | undefined,
  ): (event: PlayerPlaybackEvent) => void {
    return (event) => {
      const failureClass = classifyPlaybackFailureFromEvent(event);
      this.deps.diagnosticsStore.record({
        category: "playback",
        message: "MPV runtime event",
        context: {
          event: event.type,
          ...event,
          failureClass,
          recovery: recoveryForPlaybackFailure(failureClass),
        },
      });
      handler?.(event);
    };
  }
}
