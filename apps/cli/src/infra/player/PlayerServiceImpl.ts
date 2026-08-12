// =============================================================================
// Player Service Implementation
//
// Delegates to the existing mpv.ts for media playback.
// =============================================================================

import { stat } from "node:fs/promises";

import {
  INITIAL_PLAYBACK_GENERATION,
  isSamePlaybackGeneration,
  type PlaybackGeneration,
} from "@/domain/playback/playback-generation";
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
import { isTerminalHlsHttpStatus } from "@/services/playback/hls-manifest-materializer";
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
import type { MpvRequestedAction, PlayerControlService } from "./PlayerControlService";
import type {
  PlayerOptions,
  PlayerPlaybackEvent,
  PlayerPlaybackEventEnvelope,
  PlayerService,
} from "./PlayerService";

export class PlayerServiceImpl implements PlayerService {
  private persistentSession: PersistentMpvSession | null = null;
  private persistentSessionCreation: Promise<PersistentMpvSession> | null = null;
  private persistentSessionEpoch = 0;
  private persistentSessionRelease: Promise<void> | null = null;
  private deferredMaterializedCleanups: Array<() => Promise<void>> = [];
  private activeHlsRelay: HlsRelayHandle | null = null;
  private shuttingDown = false;
  /** One app playback intent owns the mpv handoff at a time. */
  private playbackInFlight = false;
  /**
   * Freshness identity of the mpv process/cycle this service currently owns.
   * Every asynchronous boundary captures it and compares before publishing, so
   * a replaced, stopped, or released session cannot speak through late work.
   */
  private currentGeneration: PlaybackGeneration = INITIAL_PLAYBACK_GENERATION;
  /** Which generation installed the control the app is currently holding. */
  private activeControlGeneration: PlaybackGeneration | null = null;

  constructor(
    private deps: {
      logger: Logger;
      tracer: Tracer;
      diagnostics: Pick<DiagnosticsService, "record">;
      playerControl: PlayerControlService;
      config: ConfigService;
      mpv?: MpvRuntimeOptions;
      presentation?: PlayerPresentationPort;
      /** Deterministic process-boundary seam for player lifecycle tests. */
      launchMpv?: typeof launchMpv;
    },
  ) {}

  beginShutdown(): void {
    this.shuttingDown = true;
    this.invalidateProcessGeneration();
    this.stopActiveHlsRelay("session-release");
  }

  private isCurrentGeneration(generation: PlaybackGeneration): boolean {
    return isSamePlaybackGeneration(generation, this.currentGeneration);
  }

  /**
   * Retires the whole mpv process. Nothing produced by the outgoing process —
   * IPC opens, endpoint waits, process exit, property callbacks — is current
   * afterwards, so late work returns instead of publishing.
   */
  private invalidateProcessGeneration(): void {
    this.currentGeneration = { process: this.currentGeneration.process + 1, cycle: 0 };
  }

  /**
   * Installs the generation this play owns. Reusing the persistent process
   * keeps the process number and takes the next cycle; a new OS process takes
   * the next process number at cycle 1.
   */
  private activateGeneration(reuseProcess: boolean): PlaybackGeneration {
    this.currentGeneration = reuseProcess
      ? { process: this.currentGeneration.process, cycle: this.currentGeneration.cycle + 1 }
      : { process: this.currentGeneration.process + 1, cycle: 1 };
    return this.currentGeneration;
  }

  /** True when `play()` can hand this stream to the already running mpv process. */
  private willReusePersistentProcess(options: PlayerOptions): boolean {
    return (
      options.playbackMode === "autoplay-chain" && (this.persistentSession?.isReusable() ?? false)
    );
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
    if (this.playbackInFlight) {
      throw new PlaybackAbortedError("playback already in progress");
    }

    // Admission is settled; allocate and publish the generation before the
    // first await so no consumer can observe an event from an unknown cycle.
    const reuseProcess = this.willReusePersistentProcess(options);
    const retiredGeneration = reuseProcess ? null : this.currentGeneration;
    const generation = this.activateGeneration(reuseProcess);
    options.onGenerationActivated?.(generation);

    this.playbackInFlight = true;
    try {
      return await this.playOwned(stream, options, generation, retiredGeneration);
    } finally {
      this.playbackInFlight = false;
    }
  }

  private async playOwned(
    stream: StreamInfo,
    options: PlayerOptions,
    generation: PlaybackGeneration,
    retiredGeneration: PlaybackGeneration | null,
  ): Promise<PlaybackResult> {
    const publish = this.wrapPlaybackEventHandler(
      generation,
      options.onPlaybackEvent,
      options.correlation,
    );
    let terminalHlsFailure: { readonly detail?: string; readonly httpStatus?: number } | null =
      null;
    const materialized = await materializePlaybackMediaForPlayback(
      stream,
      (reason, detail, httpStatus) => {
        if (reason === "http-error" && isTerminalHlsHttpStatus(httpStatus)) {
          terminalHlsFailure = { detail, httpStatus };
          return;
        }
        // Falling through to the direct URL is fine, but a CDN that blocks our
        // fetch must not be invisible — it is the first thing to look at when a
        // stream plays in a browser yet fails here.
        if (reason !== "fetch-failed" && reason !== "http-error") return;
        this.deps.diagnostics.record(
          buildPlaybackDiagnosticEvent({
            operation: "mpv.hls-manifest.materialize-skipped",
            status: "failed",
            severity: "degraded",
            failureClass: "http",
            message: "HLS manifest prefetch failed — using the direct stream URL",
            correlation: options.correlation,
            context: { reason, detail: detail?.slice(0, 160), streamHost: safeUrlHost(stream.url) },
          }),
        );
      },
    );
    if (terminalHlsFailure !== null) {
      const failure = terminalHlsFailure as {
        readonly detail?: string;
        readonly httpStatus?: number;
      };
      this.deps.logger.warn("HLS stream rejected before MPV launch", {
        streamHost: safeUrlHost(stream.url),
        httpStatus: failure.httpStatus ?? null,
      });
      this.deps.diagnostics.record(
        buildPlaybackDiagnosticEvent({
          operation: "mpv.hls-manifest.rejected",
          status: "failed",
          severity: "recoverable",
          failureClass: "http",
          message: "HLS manifest rejected before player launch",
          correlation: options.correlation,
          context: {
            detail: failure.detail?.slice(0, 160),
            httpStatus: failure.httpStatus ?? null,
            streamHost: safeUrlHost(stream.url),
          },
        }),
      );
      await materialized.cleanup();
      return {
        watchedSeconds: 0,
        duration: 0,
        endReason: "error",
        resultSource: "unknown",
        playerExitedCleanly: false,
        playerExitCode: null,
        playerExitSignal: null,
        socketPathCleanedUp: true,
        lastNonZeroPositionSeconds: 0,
        lastNonZeroDurationSeconds: 0,
        suspectedDeadStream: true,
        streamRejectedBeforePlayerLaunch: true,
      };
    }
    let playbackStream = materialized.stream;
    if (materialized.kind === "dash-mpd") {
      publish({ type: "media-materialized", kind: "dash-mpd" });
    } else if (materialized.kind === "hls-manifest") {
      publish({ type: "media-materialized", kind: "hls-manifest" });
    }

    // Stop any prior cycle relay before starting a new one (autoplay-chain source swaps).
    this.stopActiveHlsRelay("session-release");
    playbackStream = this.maybeStartHlsRelay(playbackStream, options);

    publish({ type: "launching-player" });
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
          ? await this.playAutoplayChainStream(
              playbackStream,
              options,
              urlKind,
              publish,
              retiredGeneration,
            )
          : await this.playOneShotStream(
              playbackStream,
              options,
              urlKind,
              publish,
              retiredGeneration,
            );

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
    // Invalidate a create() already awaiting IPC before observing its result.
    // Otherwise shutdown/recovery can see `persistentSession === null`, return,
    // and let that late create publish a live mpv after teardown completed.
    // Generation is invalidated synchronously here, before any await, so this
    // stays the single release/disposal invalidation authority.
    const retired = this.currentGeneration;
    this.invalidateProcessGeneration();
    await this.retirePersistentSession(retired);
  }

  /**
   * Releases the persistent session that `retiredGeneration` owned. The caller
   * has already moved `currentGeneration` past it, so this must never allocate,
   * clear, or compare-and-swap the generation that is active now.
   */
  private async retirePersistentSession(
    retiredGeneration: PlaybackGeneration | null,
  ): Promise<void> {
    this.persistentSessionEpoch += 1;
    if (this.persistentSessionRelease) {
      await this.persistentSessionRelease;
      return;
    }

    const release = this.releasePersistentSessionOwned(retiredGeneration);
    this.persistentSessionRelease = release;
    try {
      await release;
    } finally {
      if (this.persistentSessionRelease === release) {
        this.persistentSessionRelease = null;
      }
    }
  }

  private async releasePersistentSessionOwned(
    retiredGeneration: PlaybackGeneration | null,
  ): Promise<void> {
    const pendingCreation = this.persistentSessionCreation;
    let session = this.persistentSession;
    if (!session && pendingCreation) {
      session = await pendingCreation.catch(() => null);
    }

    if (!session) {
      this.stopActiveHlsRelay("session-release");
      await this.flushDeferredMaterializedCleanups();
      return;
    }
    if (session.isAlive()) {
      await session.close();
    }
    if (this.persistentSession === session) {
      this.persistentSession = null;
    }
    this.clearActiveControlFor(retiredGeneration);
    this.stopActiveHlsRelay("session-release");
    await this.flushDeferredMaterializedCleanups();
  }

  /** Publishes a control only while its generation is current, and records the owner. */
  private setActiveControlFor(
    generation: PlaybackGeneration,
    control: Parameters<PlayerControlService["setActive"]>[0],
  ): void {
    if (!this.isCurrentGeneration(generation)) return;
    this.activeControlGeneration = control ? generation : null;
    this.deps.playerControl.setActive(control);
  }

  /**
   * Retirement clears only the control it owned. A replacement that already
   * installed its own control keeps it.
   */
  private clearActiveControlFor(retiredGeneration: PlaybackGeneration | null): void {
    const owner = this.activeControlGeneration;
    if (owner && retiredGeneration && !isSamePlaybackGeneration(owner, retiredGeneration)) return;
    this.activeControlGeneration = null;
    this.deps.playerControl.setActive(null);
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
    onGenerationActivated?: (generation: PlaybackGeneration) => void;
    onPlaybackEvent?: (input: PlayerPlaybackEventEnvelope) => void;
  }): Promise<PlaybackResult> {
    if (this.shuttingDown) {
      throw new PlaybackAbortedError("player shutting down");
    }
    if (this.playbackInFlight) {
      throw new PlaybackAbortedError("playback already in progress");
    }

    // Order matters and is load-bearing: capture the persistent generation being
    // retired, install this one-shot generation, publish it — all before the
    // first await — so retiring the persistent session cannot invalidate it.
    const retiredPersistentGeneration = this.currentGeneration;
    const localGeneration = this.activateGeneration(false);
    options.onGenerationActivated?.(localGeneration);

    this.playbackInFlight = true;
    try {
      return await this.playLocalOwned(options, localGeneration, retiredPersistentGeneration);
    } finally {
      this.playbackInFlight = false;
    }
  }

  private async playLocalOwned(
    options: {
      source: LocalPlaybackSource;
      attach?: boolean;
      startAt?: number;
      policy?: LocalPlaybackPolicyInput;
      onPlayerReady?: () => void;
      onGenerationActivated?: (generation: PlaybackGeneration) => void;
      onPlaybackEvent?: (input: PlayerPlaybackEventEnvelope) => void;
    },
    localGeneration: PlaybackGeneration,
    retiredPersistentGeneration: PlaybackGeneration,
  ): Promise<PlaybackResult> {
    const publish = this.wrapPlaybackEventHandler(localGeneration, options.onPlaybackEvent);
    // Local playback is one-shot. Retire an idle autoplay-chain process first
    // so only the local player owns controls and a visible mpv window.
    await this.retirePersistentSession(retiredPersistentGeneration);
    const subtitlePath = await this.resolveReadableSubtitlePath(
      options.source.subtitlePath ?? null,
    );
    const displayTitle = formatLocalPlaybackTitle(options.source);
    publish({ type: "launching-player" });
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
    const result = await (this.deps.launchMpv ?? launchMpv)({
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
      onControlReady: (control) => this.setActiveControlFor(localGeneration, control),
      onPlayerReady: options.onPlayerReady,
      onPlaybackEvent: publish,
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
    publish: (event: PlayerPlaybackEvent) => void,
    retiredGeneration: PlaybackGeneration | null,
  ): Promise<PlaybackResult> {
    const generation = this.currentGeneration;
    await this.retirePersistentSession(retiredGeneration);
    return await (this.deps.launchMpv ?? launchMpv)({
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
      onControlReady: (control) => this.setActiveControlFor(generation, control),
      onPlayerReady: options.onPlayerReady,
      onPlaybackEvent: publish,
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
    publish: (event: PlayerPlaybackEvent) => void,
    retiredGeneration: PlaybackGeneration | null,
  ): Promise<PlaybackResult> {
    const generation = this.currentGeneration;
    if (this.persistentSession && !this.persistentSession.isReusable()) {
      await this.retirePersistentSession(retiredGeneration);
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
      onPlaybackEvent: publish,
      onMpvActionRequest: (action: MpvRequestedAction) => {
        this.deps.playerControl.signalPlaybackAction(action);
      },
      onNearEof: options.onNearEof,
      shareLinkContext: options.shareLinkContext,
    };

    if (!this.persistentSession) {
      const creationEpoch = this.persistentSessionEpoch;
      const creation = PersistentMpvSession.create({
        stream,
        options: sharedOptions,
        mpv: {
          ...this.deps.mpv,
          startupPriority: this.deps.config.startupPriority,
        },
        kitsuneConfig: this.deps.config.getRaw(),
        onControlReady: (control) => this.setActiveControlFor(generation, control),
      });
      this.persistentSessionCreation = creation;
      let created: PersistentMpvSession;
      try {
        created = await creation;
      } finally {
        if (this.persistentSessionCreation === creation) {
          this.persistentSessionCreation = null;
        }
      }
      if (
        this.shuttingDown ||
        options.abortSignal?.aborted ||
        creationEpoch !== this.persistentSessionEpoch
      ) {
        if (created.isAlive()) await created.close();
        throw new PlaybackAbortedError("playback aborted during player startup");
      }
      this.persistentSession = created;
      const result = await created.waitForCurrentPlayback();
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

  /**
   * The single public boundary. Raw `PlayerPlaybackEvent` callbacks live only
   * below this line; above it every consumer receives an envelope carrying the
   * generation that produced the event. A retired generation returns here, so
   * it can publish neither a public event nor a diagnostic.
   */
  private wrapPlaybackEventHandler(
    generation: PlaybackGeneration,
    handler: ((input: PlayerPlaybackEventEnvelope) => void) | undefined,
    correlation: PlayerOptions["correlation"] = undefined,
  ): (event: PlayerPlaybackEvent) => void {
    return (event) => {
      if (!this.isCurrentGeneration(generation)) return;
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
      handler?.({ generation, event });
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
