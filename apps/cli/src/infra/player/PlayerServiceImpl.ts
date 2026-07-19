// =============================================================================
// Player Service Implementation
//
// Delegates to the existing mpv.ts for media playback.
// =============================================================================

import { stat } from "node:fs/promises";

import type { PlaybackResult, StreamInfo } from "@/domain/types";
import type { Logger } from "@/infra/logger/Logger";
import type { Tracer } from "@/infra/tracer/Tracer";
import { launchMpv, shouldApplyStartAtSeek } from "@/mpv";
import { formatTimestamp } from "@/services/continuation/history-progress";
import {
  buildPlaybackDiagnosticEvent,
  type DiagnosticFailureClass,
} from "@/services/diagnostics/diagnostic-event-helpers";
import type { DiagnosticsService } from "@/services/diagnostics/DiagnosticsService";
import type { LocalPlaybackSource } from "@/services/offline/local-playback-source";
import type { ConfigService } from "@/services/persistence/ConfigService";
import { materializePlaybackMediaForPlayback } from "@/services/playback/playback-media-materializer";

import {
  startHlsRelay,
  streamNeedsHlsRelay,
  type HlsRelayHandle,
  type HlsRelayStopReason,
} from "./hls-relay";
import { resolveLocalPlaybackPolicy, type LocalPlaybackPolicyInput } from "./local-playback-policy";
import { killActiveMpvProcessesSync as killRegisteredMpvProcesses } from "./mpv-process-registry";
import type { MpvRuntimeOptions } from "./mpv-runtime-options";
import { PersistentMpvSession } from "./PersistentMpvSession";
import { PlaybackAbortedError } from "./playback-aborted";
import {
  classifyPlaybackFailureFromEvent,
  classifyPlaybackFailureFromResult,
  recoveryForPlaybackFailure,
} from "./playback-failure-classifier";
import type { PlayerPresentationPort } from "./player-presentation-port";
import { nonInteractivePlayerPresentation } from "./player-presentation-port";
import type { PlayerControlService } from "./PlayerControlService";
import type { PlayerOptions, PlayerPlaybackEvent, PlayerService } from "./PlayerService";

export class PlayerServiceImpl implements PlayerService {
  private persistentSession: PersistentMpvSession | null = null;
  private deferredMaterializedCleanups: Array<() => Promise<void>> = [];
  private activeHlsRelay: HlsRelayHandle | null = null;
  private shuttingDown = false;

  constructor(
    private deps: {
      logger: Logger;
      tracer: Tracer;
      diagnostics: Pick<DiagnosticsService, "record">;
      playerControl: PlayerControlService;
      config: ConfigService;
      mpv?: MpvRuntimeOptions;
      presentation?: PlayerPresentationPort;
    },
  ) {}

  beginShutdown(): void {
    this.shuttingDown = true;
    this.stopActiveHlsRelay("session-release");
  }

  killActiveMpvProcessesSync(): void {
    killRegisteredMpvProcesses();
  }

  async play(stream: StreamInfo, options: PlayerOptions): Promise<PlaybackResult> {
    if (this.shuttingDown) {
      throw new PlaybackAbortedError("player shutting down");
    }
    if (options.abortSignal?.aborted) {
      throw new PlaybackAbortedError("playback aborted");
    }

    const materialized = await materializePlaybackMediaForPlayback(stream);
    let playbackStream = materialized.stream;
    if (materialized.kind === "dash-mpd") {
      options.onPlaybackEvent?.({ type: "media-materialized", kind: "dash-mpd" });
    } else if (materialized.kind === "hls-manifest") {
      options.onPlaybackEvent?.({ type: "media-materialized", kind: "hls-manifest" });
    }

    // Stop any prior cycle relay before starting a new one (autoplay-chain source swaps).
    this.stopActiveHlsRelay("session-release");
    playbackStream = this.maybeStartHlsRelay(playbackStream, options);

    options.onPlaybackEvent?.({ type: "launching-player" });
    const presentation = this.deps.presentation ?? nonInteractivePlayerPresentation;
    if (!presentation.isInteractiveShellMounted()) {
      process.stderr.write(`Starting playback: ${options.displayTitle}\n`);
      process.stderr.write(
        playbackStream.subtitle
          ? "Subtitle attached before playback.\n"
          : `${options.subtitleStatus ?? "Subtitles not attached"}; playback will start without a subtitle file.\n`,
      );
    }

    this.deps.logger.info("Launching MPV", {
      title: options.displayTitle,
      streamHost: safeUrlHost(playbackStream.url),
      startAt: options.startAt,
      resumePromptAt: options.resumePromptAt ?? 0,
    });
    this.deps.diagnostics.record(
      buildPlaybackDiagnosticEvent({
        operation: "mpv.launch.started",
        status: "started",
        severity: "healthy",
        recommendedAction: "none",
        message: "Launching MPV",
        correlation: options.correlation,
        context: {
          title: options.displayTitle,
          hasSubtitle: Boolean(playbackStream.subtitle),
          streamHost: safeUrlHost(playbackStream.url),
          subtitleHost: safeUrlHost(playbackStream.subtitle),
          subtitleStatus: options.subtitleStatus ?? null,
          startAt: options.startAt ?? 0,
          resumePromptAt: options.resumePromptAt ?? 0,
          deferredMedia: Boolean(stream.deferredLocator),
          materializedMedia: materialized.kind,
          hlsRelay: Boolean(this.activeHlsRelay),
        },
      }),
    );

    try {
      const urlKind = materialized.kind === "none" ? "remote" : "local";
      const result =
        options.playbackMode === "autoplay-chain"
          ? await this.playAutoplayChainStream(playbackStream, options, urlKind)
          : await this.playOneShotStream(playbackStream, options, urlKind);

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
      const playbackFailureClass = classifyPlaybackFailureFromResult(result);
      this.deps.diagnostics.record(
        buildPlaybackDiagnosticEvent({
          operation: "mpv.playback.completed",
          status: result.endReason === "error" ? "failed" : "succeeded",
          severity: result.endReason === "error" ? "recoverable" : "healthy",
          failureClass: result.endReason === "error" ? "unknown" : undefined,
          recommendedAction: result.endReason === "error" ? undefined : "none",
          message: "MPV playback complete",
          correlation: options.correlation,
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
            failureClass: playbackFailureClass,
            recovery: recoveryForPlaybackFailure(playbackFailureClass),
          },
        }),
      );

      return result;
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      const actionableHint = errorMessage.toLowerCase().includes("mpv")
        ? "mpv is required for playback. Install mpv and retry."
        : "Run / export-diagnostics and / report-issue if this keeps failing.";
      this.deps.logger.error("MPV playback failed", { error: String(e) });
      this.deps.diagnostics.record(
        buildPlaybackDiagnosticEvent({
          operation: "mpv.playback.failed",
          status: "failed",
          severity: "blocked",
          failureClass: "dependency",
          message: "MPV playback failed",
          correlation: options.correlation,
          context: { error: errorMessage, hint: actionableHint },
        }),
      );
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
    } finally {
      const shouldDeferCleanup =
        options.playbackMode === "autoplay-chain" &&
        (this.persistentSession?.isReusable() ?? false);
      if (shouldDeferCleanup) {
        this.deferMaterializedCleanup(materialized.cleanup);
        // Keep activeHlsRelay for the next cycle; play() stops/replaces it at the top.
      } else {
        this.stopActiveHlsRelay("playback-end");
        await materialized.cleanup();
      }
    }
  }

  async releasePersistentSession(): Promise<void> {
    if (!this.persistentSession) {
      this.stopActiveHlsRelay("session-release");
      await this.flushDeferredMaterializedCleanups();
      return;
    }
    await this.persistentSession.close();
    this.persistentSession = null;
    this.deps.playerControl.setActive(null);
    this.stopActiveHlsRelay("session-release");
    await this.flushDeferredMaterializedCleanups();
  }

  private deferMaterializedCleanup(cleanup: () => Promise<void>): void {
    this.deferredMaterializedCleanups.push(cleanup);
  }

  private async flushDeferredMaterializedCleanups(): Promise<void> {
    const pending = this.deferredMaterializedCleanups;
    this.deferredMaterializedCleanups = [];
    await Promise.all(
      pending.map(async (run) => {
        try {
          await run();
        } catch {
          // Best-effort temp cleanup; do not block session teardown.
        }
      }),
    );
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(Bun.which("mpv"));
  }

  async playLocal(options: {
    source: LocalPlaybackSource;
    attach?: boolean;
    startAt?: number;
    policy?: LocalPlaybackPolicyInput;
    onPlayerReady?: () => void;
    onPlaybackEvent?: (event: PlayerPlaybackEvent) => void;
  }): Promise<PlaybackResult> {
    const subtitlePath = await this.resolveReadableSubtitlePath(
      options.source.subtitlePath ?? null,
    );
    const displayTitle = formatLocalPlaybackTitle(options.source);
    options.onPlaybackEvent?.({ type: "launching-player" });
    this.deps.logger.info("Launching local MPV", {
      title: displayTitle,
      filePath: options.source.filePath,
    });
    this.deps.diagnostics.record({
      category: "playback",
      message: "Launching local MPV",
      context: {
        titleId: options.source.titleId,
        jobId: options.source.jobId,
        title: displayTitle,
        filePath: options.source.filePath,
        hasSubtitle: Boolean(subtitlePath),
      },
    });

    const policy = resolveLocalPlaybackPolicy(options.policy ?? {});
    const result = await launchMpv({
      url: options.source.filePath,
      urlKind: "local",
      headers: {},
      subtitle: subtitlePath,
      subtitleUrlKind: "local",
      displayTitle,
      attach: options.attach,
      startAt: options.startAt,
      timing: options.source.timing,
      autoSkipEnabled: policy.autoSkipEnabled,
      skipRecap: policy.skipRecap,
      skipIntro: policy.skipIntro,
      skipPreview: policy.skipPreview,
      skipCredits: policy.skipCredits,
      onPlayerReady: options.onPlayerReady,
      onPlaybackEvent: this.wrapPlaybackEventHandler(options.onPlaybackEvent),
      mpv: {
        ...this.deps.mpv,
        startupPriority: this.deps.config.startupPriority,
      },
    });

    return result;
  }

  private async resolveReadableSubtitlePath(subtitlePath: string | null): Promise<string | null> {
    if (!subtitlePath) return null;
    try {
      const fileStat = await stat(subtitlePath);
      if (fileStat.isFile() && fileStat.size > 0) return subtitlePath;
    } catch {
      // fall through to launch without a broken sidecar path
    }
    this.deps.logger.warn("Skipping unreadable local subtitle sidecar", { subtitlePath });
    this.deps.diagnostics.record({
      category: "subtitle",
      message: "Skipping unreadable local subtitle sidecar",
      context: { subtitlePath },
    });
    return null;
  }

  private async playOneShotStream(
    stream: StreamInfo,
    options: PlayerOptions,
    urlKind: "remote" | "local",
  ): Promise<PlaybackResult> {
    await this.releasePersistentSession();
    return await launchMpv({
      url: stream.url,
      urlKind,
      headers: stream.headers ?? {},
      subtitle: stream.subtitle ?? null,
      subtitleUrlKind: "remote",
      audioPreference: options.audioPreference,
      subtitlePreference: options.subtitlePreference,
      subtitleTracks: stream.subtitleList,
      displayTitle: options.displayTitle,
      startAt: options.startAt,
      requiresYtdl: stream.requiresYtdl,
      ytdlFormat: stream.ytdlFormat,
      ytdlRawOptions: stream.ytdlRawOptions,
      attach: options.attach,
      timing: options.timing,
      autoSkipEnabled: options.autoSkipEnabled,
      skipRecap: options.skipRecap,
      skipIntro: options.skipIntro,
      skipPreview: options.skipPreview,
      skipCredits: options.skipCredits,
      onControlReady: (control) => this.deps.playerControl.setActive(control),
      onPlayerReady: options.onPlayerReady,
      onPlaybackEvent: this.wrapPlaybackEventHandler(options.onPlaybackEvent, options.correlation),
      mpv: {
        ...this.deps.mpv,
        startupPriority: this.deps.config.startupPriority,
      },
    });
  }

  private async playAutoplayChainStream(
    stream: StreamInfo,
    options: PlayerOptions,
    urlKind: "remote" | "local",
  ): Promise<PlaybackResult> {
    if (this.persistentSession && !this.persistentSession.isReusable()) {
      await this.releasePersistentSession();
    }

    const resumePromptAt = options.resumePromptAt ?? 0;
    const offerResumeStartChoice =
      shouldApplyStartAtSeek(resumePromptAt) && options.resumeStartChoicePrompt !== false;

    const sharedOptions = {
      displayTitle: options.displayTitle,
      urlKind,
      subtitleUrlKind: "remote" as const,
      audioPreference: options.audioPreference,
      subtitlePreference: options.subtitlePreference,
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
      autoSkipEnabled: options.autoSkipEnabled,
      skipRecap: options.skipRecap,
      skipIntro: options.skipIntro,
      skipPreview: options.skipPreview,
      skipCredits: options.skipCredits,
      autoNextEnabled: true,
      onPlayerReady: options.onPlayerReady,
      onPlaybackEvent: this.wrapPlaybackEventHandler(options.onPlaybackEvent, options.correlation),
      onMpvActionRequest: (action: "next" | "previous" | "pick-quality" | "refresh") => {
        this.deps.playerControl.signalPlaybackAction(action);
      },
      onNearEof: options.onNearEof,
      shareLinkContext: options.shareLinkContext,
    };

    if (!this.persistentSession) {
      this.persistentSession = await PersistentMpvSession.create({
        stream,
        options: sharedOptions,
        mpv: {
          ...this.deps.mpv,
          startupPriority: this.deps.config.startupPriority,
        },
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
    correlation: PlayerOptions["correlation"] = undefined,
  ): (event: PlayerPlaybackEvent) => void {
    return (event) => {
      const failureClass = classifyPlaybackFailureFromEvent(event);
      const diagnosticFailureClass = mapPlaybackFailureToDiagnosticFailure(failureClass);
      this.deps.diagnostics.record(
        buildPlaybackDiagnosticEvent({
          operation: operationForPlaybackEvent(event),
          stage: event.type,
          status: diagnosticFailureClass ? "failed" : "progress",
          severity: diagnosticFailureClass ? "degraded" : "healthy",
          failureClass: diagnosticFailureClass,
          message: "MPV runtime event",
          correlation,
          context: {
            event: event.type,
            ...event,
            playbackFailureClass: failureClass,
            recovery: recoveryForPlaybackFailure(failureClass),
          },
        }),
      );
      handler?.(event);
    };
  }

  private maybeStartHlsRelay(stream: StreamInfo, options: PlayerOptions): StreamInfo {
    if (!streamNeedsHlsRelay(stream.url)) {
      return stream;
    }
    try {
      const handle = startHlsRelay(stream.url, stream.headers ?? {}, {
        onStopped: (reason) => {
          this.deps.diagnostics.record(
            buildPlaybackDiagnosticEvent({
              operation: "mpv.hls-relay.stopped",
              status: "succeeded",
              severity: "healthy",
              recommendedAction: "none",
              message: "HLS relay stopped",
              correlation: options.correlation,
              context: { reason, upstreamHost: handle.upstreamHost },
            }),
          );
        },
        onUpstreamError: (info) => {
          this.deps.diagnostics.record(
            buildPlaybackDiagnosticEvent({
              operation: "mpv.hls-relay.upstream-error",
              status: "failed",
              severity: "degraded",
              failureClass: "http",
              message: "HLS relay upstream error",
              correlation: options.correlation,
              context: {
                upstreamHost: info.host,
                status: info.status ?? null,
                error: info.message.slice(0, 160),
              },
            }),
          );
        },
      });
      this.activeHlsRelay = handle;
      this.deps.logger.info("HLS relay started", { upstreamHost: handle.upstreamHost });
      this.deps.diagnostics.record(
        buildPlaybackDiagnosticEvent({
          operation: "mpv.hls-relay.started",
          status: "started",
          severity: "healthy",
          recommendedAction: "none",
          message: "HLS relay started",
          correlation: options.correlation,
          context: { upstreamHost: handle.upstreamHost },
        }),
      );
      return { ...stream, url: handle.proxyUrl };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.diagnostics.record(
        buildPlaybackDiagnosticEvent({
          operation: "mpv.hls-relay.unavailable",
          status: "failed",
          severity: "blocked",
          failureClass: "dependency",
          message: "HLS relay unavailable",
          correlation: options.correlation,
          context: { error: message.slice(0, 160), streamHost: safeUrlHost(stream.url) },
        }),
      );
      // Degrade to the direct URL instead of failing playback outright. The relay
      // exists because these CDNs reject mpv's TLS handshake, so a direct attempt
      // will probably fail too — but "probably" is not "certainly", and a missing
      // curl or an unavailable local port must not be the reason a stream that
      // used to play now cannot start at all.
      this.deps.logger.warn("HLS relay unavailable — falling back to the direct stream URL", {
        error: message,
        streamHost: safeUrlHost(stream.url),
      });
      return stream;
    }
  }

  private stopActiveHlsRelay(reason: HlsRelayStopReason): void {
    if (!this.activeHlsRelay) return;
    const handle = this.activeHlsRelay;
    this.activeHlsRelay = null;
    handle.stop(reason);
  }
}

function formatLocalPlaybackTitle(source: LocalPlaybackSource): string {
  if (source.mediaKind === "movie") return `${source.titleName}  ·  local`;
  return `${source.titleName}  ·  S${String(source.season ?? 1).padStart(2, "0")}E${String(source.episode ?? 1).padStart(2, "0")}  ·  local`;
}

function safeUrlHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function operationForPlaybackEvent(event: PlayerPlaybackEvent): string {
  switch (event.type) {
    case "network-buffering":
    case "network-sample":
    case "stream-slow":
    case "stream-stalled":
      return "mpv.network.sample";
    case "ipc-command-failed":
    case "ipc-stalled":
    case "mpv-in-process-reconnect":
      return "mpv.ipc.event";
    default:
      return "mpv.runtime.event";
  }
}

function mapPlaybackFailureToDiagnosticFailure(
  failureClass: ReturnType<typeof classifyPlaybackFailureFromEvent>,
): DiagnosticFailureClass | undefined {
  switch (failureClass) {
    case "none":
      return undefined;
    case "network-buffering":
    case "slow-stream":
    case "expired-stream":
      return "http";
    case "seek-stuck":
      return "timeout";
    case "ipc-stuck":
      return "ipc";
    default:
      return "unknown";
  }
}
