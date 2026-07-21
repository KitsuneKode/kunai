// =============================================================================
// Playback Phase
//
// Handles episode selection → stream resolve → MPV playback → post-playback.
// Returns when user wants to go back to search or switch mode.
// =============================================================================

import { capturePlaybackShellError } from "@/app-shell/playback-shell-error-capture";
import {
  openTracksPanel,
  buildPickerActionContext,
  openSubtitlePicker,
} from "@/app-shell/workflows";
import { episodeInfoFromSelection } from "@/app/bootstrap/episode-info-from-catalog";
import { consumeShareBootstrapStartSeconds } from "@/app/bootstrap/share-bootstrap-start";
import { resolveTitleHistoryLookupId } from "@/app/bootstrap/title-info";
import { resolveLocalEpisodePlayback } from "@/app/playback/episode-playback-source";
import {
  adoptEpisodePrefetchBundle,
  EpisodePrefetchHandle,
  isEpisodePrefetchEligible,
  type EpisodePrefetchBundle,
  type EpisodePrefetchProgress,
  type EpisodePrefetchTarget,
} from "@/app/playback/episode-prefetch";
import { describeMpvPlayerEvent } from "@/app/playback/mpv-playback-event-copy";
import {
  dismissMpvTransitionOverlay,
  MAX_AUTO_SOURCE_RECOVER_ATTEMPTS,
  releasePersistentMpvForTerminalFailure,
  shouldReleasePersistentMpvBeforePostPlay,
} from "@/app/playback/mpv-session-lifecycle";
import { planCatalogAutoAdvance } from "@/app/playback/playback-catalog-autoadvance";
import {
  createDeadStreamUrlLedger,
  playbackDeadStreamScopeKey,
} from "@/app/playback/playback-dead-stream-ledger";
import { gatePlaybackDependencies } from "@/app/playback/playback-dependency-gate";
import { applyPlaybackEpisodeNavigation } from "@/app/playback/playback-episode-navigation";
import { buildPlaybackEpisodePickerOptions } from "@/app/playback/playback-episode-picker";
import { createPlaybackIteration } from "@/app/playback/playback-iteration";
import {
  resolvePlaylistAutoNextCountdown,
  type PlaybackOutcome,
} from "@/app/playback/playback-outcome";
import { planPlaylistAutoAdvance } from "@/app/playback/playback-playlist-autoadvance";
import {
  createPostPlaybackMenuDeps,
  runPostPlaybackMenuAfterEpisode,
} from "@/app/playback/playback-post-play-entry";
import {
  preparePostPlaybackSurface,
  teardownPlaybackForPostPlayExit,
} from "@/app/playback/playback-post-play-lifecycle";
import {
  canAutoContinueIntoRecommendation,
  canAdvanceIntoRecommendation,
} from "@/app/playback/playback-postplay-policy";
import {
  playbackAudioPreference,
  playbackQualityPreference,
  playbackSubtitlePreference,
} from "@/app/playback/playback-profile-context";
import {
  pickCompatibleFallbackProvider,
  switchPlaybackProviderFallback,
} from "@/app/playback/playback-provider-fallback";
import { resolvePlaybackProviderHandoff } from "@/app/playback/playback-provider-handoff";
import {
  promoteSoftFallbackAfterEngage,
  resolveStreamProviderId,
  resolveTitleProviderPreference,
} from "@/app/playback/playback-provider-switch";
import { resolvePlaybackResolvePolicy } from "@/app/playback/playback-resolve-policy";
import {
  createBootstrapResumeResolver,
  resumeSecondsFromHistoryForEpisode,
} from "@/app/playback/playback-resume-from-history";
import { createPlaybackRunState } from "@/app/playback/playback-run-state";
import { PlaybackSelectionCoordinator } from "@/app/playback/playback-selection-coordinator";
import {
  createPlaybackSessionState,
  didPlaybackFailToStart,
  resolvePlaybackResultDecision,
  syncPlaybackSessionState,
  transitionPlaybackSessionPhase,
  type PlaybackSessionPhaseEvent,
  type PlaybackSessionState,
} from "@/app/playback/playback-session-controller";
import { invalidateEpisodePlaybackCaches } from "@/app/playback/playback-source-cache-invalidation";
import {
  listOrderedPlaybackSourceIds,
  planStartupFailover,
  STARTUP_STALL_TIMEOUT_MS,
} from "@/app/playback/playback-source-failover";
import {
  startAtResumePoint,
  startEpisodeNavigation,
  startFromBeginning,
  startFromEpisodeSelection,
} from "@/app/playback/playback-start-intent";
import {
  applyPlaybackControlTrackSelection,
  buildTrackOverrideDiagnosticContext,
} from "@/app/playback/playback-track-selection-policy";
import { type AutoAdvanceGuards } from "@/app/playback/policies/auto-advance-policy";
import {
  applyMpvEpisodeLoadingOverlay,
  applyMpvStreamSwitchOverlay,
} from "@/app/playback/policies/mpv-transition-overlay-policy";
import {
  playbackStartupStageForPlayerEvent,
  summarizeStartupStreamSource,
} from "@/app/playback/policies/startup-stage-policy";
import { createQueuePlaybackAttempt } from "@/app/playback/queue-playback-attempt";
import {
  recentPlaybackStreamKey,
  recentPlaybackStreamMatchesProvider,
  type RecentPlaybackStreamProvenance,
  type RecentPlaybackStreamRecord,
} from "@/app/playback/recent-playback-stream";
import { createResolveTraceStub } from "@/app/playback/resolve-trace";
import { runMpvPlaybackSession } from "@/app/playback/run-mpv-playback-session";
import { planEpisodeIterationDirective } from "@/app/playback/run-playback-episode-iteration";
import {
  applyPreferredStreamSelection,
  shouldSkipExternalSubtitleLookup,
  streamSelectionFromTrackPick,
  type StreamSelectionIntent,
} from "@/app/playback/source-quality";
import {
  createSourceRefreshCooldownState,
  resolveSourceRefreshDecision,
} from "@/app/playback/source-refresh-policy";
import {
  choosePlaybackSubtitle,
  shouldAttemptLateSubtitleLookup,
} from "@/app/playback/subtitle-selection";
import { describePlaybackSubtitleStatus } from "@/app/playback/subtitle-status";
import { applyTrackPickRestart } from "@/app/playback/track-pick-restart";
import { runAutoplayAdvanceCountdown } from "@/app/post-play/autoplay-advance-countdown";
import { PostPlaybackRecommendationRail } from "@/app/post-play/post-playback-recommendations";
import type { Phase, PhaseResult, PhaseContext } from "@/app/session/Phase";
import { resolveProvenNumericTmdbId } from "@/domain/catalog/tmdb-identity";
import { kitsuneErrorFromUnknown } from "@/domain/kitsune-error-mapping";
import { classifyPersistedKind } from "@/domain/media/content-kind";
import { usesProviderNativeEpisodeCatalog } from "@/domain/media/provider-native-episodes";
import { enrichExternalIdsWithVideoMeta } from "@/domain/media/video-meta";
import { shouldPersistHistory, toHistoryTimestamp } from "@/domain/playback/playback-history";
import {
  didPlaybackReachCompletionThreshold,
  resolveEpisodeAvailability,
  toEpisodeNavigationState,
} from "@/domain/playback/playback-policy";
import {
  buildPlayerFailureProblem,
  buildProviderResolveProblem,
  type PlaybackProblem,
} from "@/domain/playback/playback-problem";
import {
  evaluateProgressEngage,
  trustedProgressFromPlaybackResult,
} from "@/domain/playback/progress-engage-policy";
import {
  describeProviderResolveAttemptDetail,
  describeProviderResolveAttemptNote,
} from "@/domain/playback/provider-resolve-copy";
import { decideSoftFallbackOnResolve } from "@/domain/playback/soft-fallback-preference-policy";
import type { DecodedTrackSelection } from "@/domain/playback/track-capabilities";
import { formatQueueEntryLabel } from "@/domain/queue/queue-entry-label";
import type {
  TitleInfo,
  EpisodeInfo,
  EpisodePickerOption,
  PlaybackTimingMetadata,
  StreamInfo,
  PlaybackResult,
  SubtitleTrack,
  SearchResult,
} from "@/domain/types";
import { PlaybackAbortedError } from "@/infra/player/playback-aborted";
import { classifyPlaybackFailureFromResult } from "@/infra/player/playback-failure-classifier";
import type { PlayerPlaybackEvent } from "@/infra/player/PlayerService";
import {
  AniSkipTimingSource,
  extractProviderNativeTiming,
  IntroDbTimingSource,
  mergeTimingMetadata,
  PlaybackTimingAggregator,
  type PlaybackTimingOutcomeClass,
  type PlaybackTimingSourceOutcome,
} from "@/infra/timing";
import { fetchTitleDetail, peekTitleDetail } from "@/services/catalog/TitleDetailService";
import { PlaybackHistoryLedger } from "@/services/continuation/playback-history-ledger";
import { runBackgroundTask } from "@/services/diagnostics/background-task";
import {
  createCorrelationId,
  type DiagnosticCorrelation,
} from "@/services/diagnostics/correlation";
import {
  buildPlaybackDiagnosticEvent,
  buildRecoveryDiagnosticEvent,
  buildSubtitleDiagnosticEvent,
  type DiagnosticFailureClass,
} from "@/services/diagnostics/diagnostic-event-helpers";
import { observeResolveNetworkOutcome } from "@/services/network/network-observation";
import {
  createPlaybackStartupTimeline,
  formatPlaybackStartupTimeline,
  formatStartupPhaseBreakdown,
  type PlaybackStartupStage,
  summarizeStartupPhases,
} from "@/services/playback/playback-startup-timeline";
import { enqueueReleaseReconciliation } from "@/services/release-reconciliation/enqueue-release-reconciliation";
import { mergeSubtitleTracks, resolveSubtitlesByTmdbId, selectAutomaticSubtitle } from "@/subtitle";
import { fetchEpisodes, fetchSeasons } from "@/tmdb";
import type { ResolveAttempt } from "@kunai/core";

// Re-exported for tests that import it from this module's public surface.
export type { PlaybackOutcome } from "@/app/playback/playback-outcome";
export { playbackStartupStageForPlayerEvent };

const timingAggregator = new PlaybackTimingAggregator([IntroDbTimingSource, AniSkipTimingSource]);

function playbackTimingCacheKey(
  title: TitleInfo,
  episode: EpisodeInfo,
  providerId?: string,
): string {
  const providerPart = providerId ?? "";
  if (title.type === "movie") return `movie:${title.id}:${providerPart}`;
  return `series:${title.id}:${episode.season}:${episode.episode}:${providerPart}`;
}

function mapTimingOutcomeToDiagnosticFailure(
  failureClass: PlaybackTimingOutcomeClass,
): DiagnosticFailureClass | undefined {
  switch (failureClass) {
    case "timeout":
      return "timeout";
    case "offline":
      return "offline";
    case "http-error":
      return "http";
    case "not-found":
    case "identity-missing":
      return "not-found";
    case "cancelled":
      return "cancelled";
    case "not-applicable":
      return undefined;
  }
}

function recordTimingSourceDiagnostic(
  diagnostics: PhaseContext["container"]["diagnosticsService"],
  input: {
    readonly outcome: PlaybackTimingSourceOutcome;
    readonly titleId: string;
    readonly season?: number;
    readonly episode?: number;
    readonly providerId?: string;
  },
): void {
  const { outcome } = input;
  const failureClass = outcome.failureClass
    ? mapTimingOutcomeToDiagnosticFailure(outcome.failureClass)
    : undefined;
  diagnostics.record(
    buildPlaybackDiagnosticEvent({
      operation: "playback.timing.source",
      stage: outcome.source,
      status: outcome.failureClass
        ? outcome.failureClass === "cancelled"
          ? "cancelled"
          : outcome.failureClass === "timeout"
            ? "timed-out"
            : outcome.failureClass === "not-applicable"
              ? "skipped"
              : "failed"
        : "succeeded",
      severity: outcome.failureClass ? "recoverable" : "healthy",
      durationMs: outcome.durationMs,
      failureClass,
      message: outcome.failureClass
        ? `Timing source ${outcome.source}: ${outcome.failureClass}`
        : `Timing source ${outcome.source}: ok`,
      providerId: input.providerId,
      titleId: input.titleId,
      season: input.season,
      episode: input.episode,
      subject: {
        source: outcome.source,
        outcomeClass: outcome.failureClass,
      },
    }),
  );
}

export class PlaybackPhase implements Phase<TitleInfo, PlaybackOutcome> {
  name = "playback";

  private static readonly lateSubtitleInflight = new Set<string>();
  private playbackLedger: PlaybackHistoryLedger | null = null;
  private unregisterActiveCheckpoint: (() => void) | null = null;

  private updatePlaybackFeedback(
    context: PhaseContext,
    feedback: { detail?: string | null; note?: string | null },
  ) {
    context.container.stateManager.dispatch({
      type: "SET_PLAYBACK_FEEDBACK",
      detail: feedback.detail,
      note: feedback.note,
    });
  }

  private transitionPlaybackSession(
    context: PhaseContext,
    session: PlaybackSessionState,
    event: PlaybackSessionPhaseEvent,
    meta: Record<string, unknown> = {},
  ): PlaybackSessionState {
    const nextSession = transitionPlaybackSessionPhase(session, event);
    if (nextSession.phase !== session.phase) {
      context.container.diagnosticsService.record({
        category: "playback",
        operation: "playback.session.phase",
        message: `Playback session phase: ${nextSession.phase}`,
        context: {
          from: session.phase,
          to: nextSession.phase,
          event,
          ...meta,
        },
      });
    }
    return nextSession;
  }

  private async runAutoNextCountdown(
    context: PhaseContext,
    episode: EpisodeInfo,
  ): Promise<"continue" | "cancelled" | "skipped"> {
    const { stateManager, playerControl } = context.container;
    const episodeLabel = `S${String(episode.season).padStart(2, "0")}E${String(
      episode.episode,
    ).padStart(2, "0")}`;
    let cancelledByAction = false;

    // Paint the loading pane up front so mpv does not sit on a black idle frame
    // during the countdown (on natural EOF the previous file-loaded already cleared
    // kunai-loading, and the commit-time overlay is 3s away). This is the auto-next
    // analogue of the manual `n` path, which paints locally in the Lua bridge before
    // signalling. Cleared below if the user cancels so a paused-idle window does not
    // keep showing "loading".
    await applyMpvEpisodeLoadingOverlay(playerControl.getActive(), episode);

    const outcome = await runAutoplayAdvanceCountdown({
      seconds: 3,
      signal: context.signal,
      sleep: (ms) => Bun.sleep(ms),
      onTick: (remaining) => {
        this.updatePlaybackFeedback(context, {
          detail: "Auto-next ready",
          note: `Next ${episodeLabel} in ${remaining}s  ·  n now  ·  a pause`,
        });
      },
      isCancelled: () => {
        const state = stateManager.getState();
        return cancelledByAction || state.autoplaySessionPaused || state.stopAfterCurrent;
      },
      shouldSkip: () => {
        const action = playerControl.consumeLastAction();
        if (!action) return false;
        if (action === "next") return true;
        if (action === "stop" || action === "back-to-search" || action === "previous") {
          cancelledByAction = true;
        }
        return false;
      },
    });

    if (outcome === "cancelled") {
      // No advance is coming; drop the pre-painted loading pane so the paused idle
      // window is clean instead of frozen on "Loading…".
      await playerControl.getActive()?.setEpisodeTransitionLoading?.(null);
    }

    return outcome;
  }

  private updatePresenceInBackground(
    context: PhaseContext,
    task: string,
    activity: Parameters<PhaseContext["container"]["presence"]["updatePlayback"]>[0],
    correlation?: DiagnosticCorrelation,
  ): void {
    runBackgroundTask({
      task,
      category: "presence",
      diagnostics: context.container.diagnosticsService,
      context: {
        ...correlation,
        titleId: activity.title.id,
        providerId: activity.providerId,
        season: activity.episode.season,
        episode: activity.episode.episode,
      },
      run: () => {
        const shellTitle = context.container.stateManager.getState().currentTitle;
        const detailPoster = peekTitleDetail(activity.title.id, activity.title.type)?.artwork
          ?.poster;
        const enrichedTitle =
          shellTitle && shellTitle.id === activity.title.id
            ? {
                ...activity.title,
                posterUrl:
                  activity.title.posterUrl ?? shellTitle.posterUrl ?? detailPoster ?? undefined,
                artwork: activity.title.artwork ?? shellTitle.artwork,
              }
            : detailPoster
              ? {
                  ...activity.title,
                  posterUrl: activity.title.posterUrl ?? detailPoster,
                }
              : activity.title;
        return context.container.presence.updatePlayback({
          ...activity,
          title: enrichedTitle,
        });
      },
    });
  }

  private clearPresenceInBackground(
    context: PhaseContext,
    task: string,
    reason: string,
    correlation?: DiagnosticCorrelation,
  ): void {
    runBackgroundTask({
      task,
      category: "presence",
      diagnostics: context.container.diagnosticsService,
      context: { ...correlation, reason },
      run: () => context.container.presence.clearPlayback(reason),
    });
  }

  /** Dispatches the error status to the UI and waits for the user to dismiss it. */
  private async showPlaybackError(
    context: PhaseContext,
    message: string,
    cause?: unknown,
  ): Promise<void> {
    if (cause !== undefined) {
      capturePlaybackShellError(cause);
    } else {
      capturePlaybackShellError(new Error(message));
    }
    const { stateManager } = context.container;
    stateManager.dispatch({
      type: "SET_PLAYBACK_STATUS",
      status: "error",
      error: message,
    });
    await new Promise<void>((resolve) => {
      const unsubscribe = stateManager.subscribe((state) => {
        if (state.playbackStatus !== "error") {
          unsubscribe();
          resolve();
        }
      });
    });
  }

  private async showPlaybackProblem(
    context: PhaseContext,
    problem: PlaybackProblem,
  ): Promise<"dismiss" | "retry"> {
    const { diagnosticsService, stateManager, player, playerControl } = context.container;
    stateManager.dispatch({
      type: "SET_PLAYBACK_PROBLEM",
      problem,
    });
    diagnosticsService.record({
      category: "playback",
      message: problem.userMessage,
      context: {
        stage: problem.stage,
        severity: problem.severity,
        cause: problem.cause,
        recommendedAction: problem.recommendedAction,
        secondaryActions: problem.secondaryActions,
      },
    });
    await releasePersistentMpvForTerminalFailure({
      player,
      playerControl,
      userMessage: problem.userMessage,
      reason: `provider-resolve:${problem.cause}`,
      diagnostics: diagnosticsService,
    });
    await this.showPlaybackError(context, problem.userMessage);
    return stateManager.getState().playbackStatus === "loading" ? "retry" : "dismiss";
  }

  private describePlayerEvent(event: PlayerPlaybackEvent): {
    detail?: string | null;
    note?: string | null;
  } {
    return describeMpvPlayerEvent(event);
  }

  async execute(title: TitleInfo, context: PhaseContext): Promise<PhaseResult<PlaybackOutcome>> {
    const { container } = context;
    PlaybackPhase.lateSubtitleInflight.clear();
    const {
      providerRegistry,
      stateManager,
      logger,
      historyRepository,
      config,
      cacheStore,
      diagnosticsService,
      playerControl,
      player,
      workControl,
    } = container;
    const animeEpisodeCatalogByProvider = new Map<
      string,
      readonly EpisodePickerOption[] | undefined
    >();
    const playbackTimingByEpisode = new Map<string, PlaybackTimingMetadata | null>();
    const run = createPlaybackRunState({
      playbackSession: createPlaybackSessionState({ autoNextEnabled: config.autoNext }),
      pendingStart: startFromBeginning(),
    });
    const selectionCoordinator = new PlaybackSelectionCoordinator({
      titleId: title.id,
      episodePlaybackSelection: container.episodePlaybackSelection,
      titlePlaybackSource: container.titlePlaybackSource,
    });
    const getPreferredStreamSelection = (
      providerId: string,
      target: EpisodeInfo,
    ): StreamSelectionIntent => selectionCoordinator.getEffective(providerId, target);
    const setPreferredStreamSelection = async (
      providerId: string,
      target: EpisodeInfo,
      selection: StreamSelectionIntent,
    ): Promise<void> => {
      await selectionCoordinator.applyEpisodeSelection(providerId, target, selection);
    };
    const sourceRefreshCooldown = createSourceRefreshCooldownState();
    const queueAttempt = title.queuePlaybackIntent
      ? createQueuePlaybackAttempt(container.queueService, title.queuePlaybackIntent)
      : null;

    const dependencyGate = await gatePlaybackDependencies({ player });
    if (!dependencyGate.ok) {
      diagnosticsService.record({
        category: "playback",
        operation: "playback.dependency.gate",
        message: dependencyGate.problem.userMessage,
        context: {
          dependency: dependencyGate.dependency,
          cause: dependencyGate.problem.cause,
          stage: dependencyGate.problem.stage,
          severity: dependencyGate.problem.severity,
          recommendedAction: dependencyGate.problem.recommendedAction,
          remediation: dependencyGate.remediation,
          titleId: title.id,
        },
      });
      stateManager.dispatch({
        type: "SET_PLAYBACK_PROBLEM",
        problem: dependencyGate.problem,
      });
      this.updatePlaybackFeedback(context, {
        detail: "Playback unavailable",
        note: dependencyGate.problem.userMessage,
      });
      return { status: "success", value: "back_to_results" };
    }

    try {
      // Episode selection (for series)
      queueAttempt?.setStage("episode-selection");
      let episode: EpisodeInfo | undefined;
      // One-shot shared start position from a share link (kunai://...&t=). Consumed once
      // here; the series path applies it via the resolver, the movie path inline below.
      // A title is either movie or series, so the two paths never double-apply it.
      const bootstrapStartSeconds = consumeShareBootstrapStartSeconds();
      const historyTitleLookup = {
        id: title.id,
        kind: classifyPersistedKind(title, stateManager.getState().mode),
        title: title.name,
        externalIds: enrichExternalIdsWithVideoMeta(
          title.externalIds,
          stateManager.getState().videoMeta,
        ),
      };
      const resolveTargetResumeSeconds = createBootstrapResumeResolver({
        sharedStartSeconds: bootstrapStartSeconds,
        resumeFromHistory: (target: EpisodeInfo) =>
          resumeSecondsFromHistoryForEpisode(
            historyRepository,
            historyTitleLookup,
            target,
            config.quitNearEndThresholdMode,
          ),
      });
      const startNavigationToEpisode = async (target: EpisodeInfo) =>
        startEpisodeNavigation({
          targetResumeSeconds: resolveTargetResumeSeconds(target),
        });
      const navigatePlaybackEpisode = async (
        target: EpisodeInfo,
        options: {
          readonly cancelPrefetchReason?: string;
          readonly loadingOrder?: "before-start" | "after-start" | "none";
          readonly resetStopAfterCurrent?: boolean;
          readonly resumeInterruptedAutoplay?: boolean;
        } = {},
      ) => {
        const result = await applyPlaybackEpisodeNavigation({
          episode: target,
          session: run.playbackSession,
          cancelPrefetchReason: options.cancelPrefetchReason,
          loadingOrder: options.loadingOrder,
          resetStopAfterCurrent: options.resetStopAfterCurrent,
          resumeInterruptedAutoplay: options.resumeInterruptedAutoplay,
          effects: {
            cancelPrefetch: (reason) => episodePrefetch.cancel(reason),
            showLoadingOverlay: (targetEpisode) =>
              applyMpvEpisodeLoadingOverlay(playerControl.getActive(), targetEpisode),
            startNavigationToEpisode,
            selectEpisode: (targetEpisode) =>
              stateManager.dispatch({ type: "SELECT_EPISODE", episode: targetEpisode }),
            setStopAfterCurrent: (enabled) =>
              stateManager.dispatch({ type: "SET_SESSION_STOP_AFTER_CURRENT", enabled }),
            setAutoplayPaused: (paused) =>
              stateManager.dispatch({ type: "SET_SESSION_AUTOPLAY_PAUSED", paused }),
          },
        });
        run.playbackSession = result.session;
        return result.startIntent;
      };
      const provider = providerRegistry.get(stateManager.getState().provider);
      const initialAnimeEpisodes = await this.getAnimeEpisodeOptions({
        title,
        mode: stateManager.getState().mode,
        provider,
        cache: animeEpisodeCatalogByProvider,
      });
      logger.info("Episode selection metadata", {
        titleId: title.id,
        mode: stateManager.getState().mode,
        provider: stateManager.getState().provider,
        episodeCount: title.episodeCount ?? null,
        animeEpisodeOptions: initialAnimeEpisodes?.length ?? 0,
      });
      diagnosticsService.record({
        category: "provider",
        message: "Episode selection metadata",
        context: {
          titleId: title.id,
          mode: stateManager.getState().mode,
          provider: stateManager.getState().provider,
          episodeCount: title.episodeCount ?? null,
          animeEpisodeOptions: initialAnimeEpisodes?.length ?? 0,
        },
      });

      let providerSwitchSeqBeforeEpisodePicker = stateManager.getState().providerSwitchSeq;
      const shellMode = stateManager.getState().mode;
      const usesNativeEpisodes = usesProviderNativeEpisodeCatalog(shellMode, title.id);

      if (title.type === "series") {
        // Check history for resume
        const history =
          historyRepository.getLatestForTitleIdentity({
            id: title.id,
            kind:
              stateManager.getState().mode === "youtube"
                ? "video"
                : stateManager.getState().mode === "anime" || title.isAnime
                  ? "anime"
                  : "series",
            externalIds: title.externalIds,
          }) ?? null;
        if (history) {
          logger.info("History found", {
            season: history.season,
            episode: history.episode,
            timestamp: history.positionSeconds,
          });
        }

        const { applyTitleProviderPreferenceToSession } =
          await import("@/app/playback/playback-provider-switch");
        applyTitleProviderPreferenceToSession(
          container,
          title.id,
          title,
          stateManager.getState().mode,
        );
        providerSwitchSeqBeforeEpisodePicker = stateManager.getState().providerSwitchSeq;

        // Session-flow owns the current season/episode selection rules until the
        // mounted root shell fully absorbs the picker stack.
        const preselectedEpisode =
          stateManager.getState().currentTitle?.id === title.id
            ? stateManager.getState().currentEpisode
            : undefined;

        const { resolvePlaybackEpisodeEntry } =
          await import("@/app-shell/title-control/smart-auto-launch");
        const providerHealth = container.providerHealth.get(stateManager.getState().provider);
        const failedProvider =
          providerHealth?.status === "degraded" || providerHealth?.status === "down";
        const seasonCount = usesNativeEpisodes
          ? (title.episodeCount ?? initialAnimeEpisodes?.length)
          : ((await fetchSeasons(title.id).catch(() => null))?.length ?? undefined);
        const episodeEntry = resolvePlaybackEpisodeEntry({
          titleId: title.id,
          titleType: title.type,
          isAnime: usesNativeEpisodes,
          launchSource: title.launchSource,
          preselectedEpisode: preselectedEpisode ?? undefined,
          history,
          seasonCount,
          failedProvider,
          flags: {},
        });

        if (episodeEntry.kind === "auto") {
          episode = episodeInfoFromSelection({
            season: episodeEntry.selection.season,
            episode: episodeEntry.selection.episode,
            isAnime: usesNativeEpisodes,
            titleId: title.id,
            animeEpisodes: initialAnimeEpisodes,
          });
          run.pendingStart =
            episodeEntry.selection.startAt !== undefined ||
            episodeEntry.selection.suppressResumePrompt
              ? startFromEpisodeSelection(episodeEntry.selection)
              : await startNavigationToEpisode(episode);
        } else {
          const { chooseStartingEpisode } = await import("@/session-flow");
          const selection = await chooseStartingEpisode({
            currentId: title.id,
            isAnime: usesNativeEpisodes,
            animeEpisodeCount: title.episodeCount,
            animeEpisodes: initialAnimeEpisodes,
            flags: {},
            getHistoryEntry: () => Promise.resolve(history),
            container,
          });

          if (!selection) {
            logger.info("Episode selection cancelled before playback", {
              titleId: title.id,
              mode: stateManager.getState().mode,
            });
            return {
              status: "success",
              value: title.launchSource === "history" ? "back_to_history" : "back_to_results",
            };
          }

          episode = episodeInfoFromSelection({
            season: selection.season,
            episode: selection.episode,
            isAnime: usesNativeEpisodes,
            titleId: title.id,
            animeEpisodes: initialAnimeEpisodes,
          });
          run.pendingStart =
            selection.startAt !== undefined || selection.suppressResumePrompt
              ? startFromEpisodeSelection(selection)
              : await startNavigationToEpisode(episode);
        }
      } else {
        // Movies have no season/episode axis but still carry saved progress.
        // Offer Resume/Restart when there is a resumable position; otherwise play
        // from the beginning (no menu). Previously movies started at 0 always.
        const movieHistory =
          historyRepository.getLatestForTitleIdentity({
            id: title.id,
            kind: stateManager.getState().mode === "youtube" ? "video" : "movie",
            externalIds: title.externalIds,
          }) ?? null;
        const { chooseMovieStartingPoint } = await import("@/session-flow");
        const selection = await chooseMovieStartingPoint({ history: movieHistory, container });
        if (!selection) {
          logger.info("Movie starting point cancelled before playback", { titleId: title.id });
          return {
            status: "success",
            value: title.launchSource === "history" ? "back_to_history" : "back_to_results",
          };
        }
        episode = { season: 1, episode: 1 };
        run.pendingStart = startFromEpisodeSelection(selection);
        if (bootstrapStartSeconds !== undefined && bootstrapStartSeconds > 0) {
          run.pendingStart = startAtResumePoint(bootstrapStartSeconds, {
            suppressResumePrompt: true,
          });
        }
      }

      stateManager.dispatch({ type: "SELECT_EPISODE", episode });
      run.playbackSession = this.transitionPlaybackSession(
        context,
        run.playbackSession,
        "episode-selected",
        {
          titleId: title.id,
          season: episode.season,
          episode: episode.episode,
        },
      );

      const episodePrefetch = new EpisodePrefetchHandle();

      // In-memory cache of recently played episode streams so backward navigation
      // (P key) reuses the exact same StreamInfo without provider resolve or cache lookup.
      const recentEpisodeStreams = new Map<string, RecentPlaybackStreamRecord>();
      const deadStreamUrls = createDeadStreamUrlLedger();
      let consumedProviderSwitchSeq = providerSwitchSeqBeforeEpisodePicker;
      const invalidateRecentEpisodeStream = (targetEpisode: EpisodeInfo): void => {
        recentEpisodeStreams.delete(recentPlaybackStreamKey(title.id, targetEpisode));
      };
      const recentStreamMatchesPreferred = (
        recent: { readonly stream: StreamInfo },
        providerId: string,
        targetEpisode: EpisodeInfo,
      ): boolean => {
        const preferred = getPreferredStreamSelection(providerId, targetEpisode);
        if (!preferred.sourceId && !preferred.streamId) return true;
        const result = recent.stream.providerResolveResult;
        if (!result) return false;
        if (preferred.streamId) return result.selectedStreamId === preferred.streamId;
        const selected = result.streams.find((stream) => stream.id === result.selectedStreamId);
        return selected?.sourceId === preferred.sourceId;
      };
      const prepareStreamSwitchRestart = async (targetEpisode: EpisodeInfo): Promise<void> => {
        run.pendingSourceRefreshAction = "recover";
        invalidateRecentEpisodeStream(targetEpisode);
        this.updatePlaybackFeedback(context, {
          detail: "Switching stream…",
          note: "Re-resolving with your selection",
        });
        await applyMpvStreamSwitchOverlay(playerControl.getActive());
      };

      // Inner playback loop
      // Tracks the previous iteration's abort controller so fire-and-forget
      // per-iteration work (late subtitle resolve/attach) is cancelled when the
      // loop advances to the next episode/retry/fallback, instead of leaking
      // into the new iteration and attaching to the wrong mpv session.
      let previousIterationAbort: AbortController | null = null;
      while (true) {
        if (context.signal.aborted) {
          stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
          this.releasePlaybackLedgerWithoutPersist();
          await container.player.releasePersistentSession();
          return { status: "cancelled" };
        }

        previousIterationAbort?.abort();
        const playbackIterationAbort = new AbortController();
        previousIterationAbort = playbackIterationAbort;
        const currentEpisode = stateManager.getState().currentEpisode;
        if (!currentEpisode) break;
        const episodeScopeKey = `${title.id}:${currentEpisode.season}:${currentEpisode.episode}`;
        if (run.autoRecoverEpisodeKey !== episodeScopeKey) {
          run.autoRecoverEpisodeKey = episodeScopeKey;
          run.autoSourceRecoverAttempts = 0;
          run.triedFailoverSourceIds = [];
          run.startupProviderHopUsed = false;
        }
        const queuedSourceOverride = playerControl.consumePendingEpisodeSourceOverride();
        if (queuedSourceOverride) {
          run.episodePlaybackSourceOverride = queuedSourceOverride;
          invalidateRecentEpisodeStream(currentEpisode);
        }
        queueAttempt?.setStage("provider-resolution");
        run.playbackSession = this.transitionPlaybackSession(
          context,
          run.playbackSession,
          "resolve-started",
          {
            titleId: title.id,
            season: currentEpisode.season,
            episode: currentEpisode.episode,
            provider: stateManager.getState().provider,
          },
        );

        const resolveController = new AbortController();
        let resolveAbortIntent: "cancel" | "fallback" | null = null;
        // Abort reasons ride on the signal (as AbortError so fetch-failure
        // classification is unchanged) — the resolve commit policy reads them
        // to decide whether a late result is kept or discarded.
        const abortResolve = (reason: string) =>
          resolveController.abort(new DOMException(reason, "AbortError"));
        const abortOnSessionStop = () =>
          abortResolve(
            typeof context.signal.reason === "string" ? context.signal.reason : "session-shutdown",
          );
        context.signal.addEventListener("abort", abortOnSessionStop, { once: true });
        resolveController.signal.addEventListener(
          "abort",
          () => {
            if (!context.signal.aborted) {
              this.updatePlaybackFeedback(context, {
                detail:
                  resolveAbortIntent === "fallback" ? "Skipping current provider…" : "Cancelling…",
                note:
                  resolveAbortIntent === "fallback"
                    ? "Trying the next compatible provider"
                    : "Returning to results",
              });
            }
          },
          { once: true },
        );
        workControl.setActive({
          id: `playback-resolve:${title.id}:${currentEpisode.season}:${currentEpisode.episode}`,
          label: `${title.name} S${String(currentEpisode.season).padStart(2, "0")}E${String(currentEpisode.episode).padStart(2, "0")}`,
          cancel: (reason) => {
            resolveAbortIntent = reason?.includes("fallback") ? "fallback" : "cancel";
            abortResolve(reason ?? "user-requested");
          },
        });

        try {
          const configuredProviderId = stateManager.getState().provider;
          if (run.sessionSoftProviderId && run.sessionSoftProviderId !== configuredProviderId) {
            run.sessionSoftProviderId = null;
          }
          const currentProvider = providerRegistry.get(
            run.sessionSoftProviderId ?? configuredProviderId,
          );

          if (!currentProvider) {
            return {
              status: "error",
              error: {
                code: "PROVIDER_UNAVAILABLE",
                message: `Provider ${stateManager.getState().provider} not found`,
                retryable: false,
              },
            };
          }

          const deadStreamScope = playbackDeadStreamScopeKey({
            titleId: title.id,
            season: currentEpisode.season,
            episode: currentEpisode.episode,
            providerId: currentProvider.metadata.id,
          });
          const providerAttemptId = createCorrelationId("provider");
          const playbackCorrelation: DiagnosticCorrelation = {
            sessionId: container.sessionId,
            playbackCycleId: createCorrelationId("playback"),
            providerAttemptId,
            traceId: providerAttemptId,
          };
          const startupTimeline = createPlaybackStartupTimeline({
            source: { providerId: currentProvider.metadata.id },
          });
          let resolvedProviderId = currentProvider.metadata.id;
          const completeSourceTrackPick = async (
            pickedEpisode: EpisodeInfo,
            picked: DecodedTrackSelection,
            selection: StreamSelectionIntent | null,
            resumeSeconds: number,
            reason: string,
          ): Promise<ReturnType<typeof startEpisodeNavigation>> => {
            const { resolveTracksPanelPick } = await import("@/app/playback/tracks-panel-pick");
            const resolved = await resolveTracksPanelPick(picked, selection, {
              container,
              title,
              episode: pickedEpisode,
              currentProviderId: resolvedProviderId,
              resumeSeconds,
              reason,
            });

            const restart = await applyTrackPickRestart({
              resolved,
              currentProviderId: resolvedProviderId,
              episode: pickedEpisode,
              resumeSeconds,
              effects: {
                applyManualSourcePick: (providerId, targetEpisode, sourceId) =>
                  selectionCoordinator.applyManualSourcePick(providerId, targetEpisode, sourceId),
                applyEpisodeSelection: (providerId, targetEpisode, streamSelection) =>
                  selectionCoordinator.applyEpisodeSelection(
                    providerId,
                    targetEpisode,
                    streamSelection,
                  ),
                invalidateRecentEpisodeStream,
                prepareStreamSwitchRestart,
              },
            });

            resolvedProviderId = restart.resolvedProviderId;
            if (restart.requiresFreshResolve) {
              run.pendingSourceRefreshAction = "recover";
              run.pendingRecomputeSources = false;
            }
            return restart.startIntent;
          };
          const applyConfirmedPlaybackTrackSelection = async (
            action: "pick-source" | "pick-stream" | "pick-quality",
            selection: StreamSelectionIntent,
            resumeSeconds: number,
          ) => {
            const outcome = await applyPlaybackControlTrackSelection({
              action,
              providerId: resolvedProviderId,
              episode: currentEpisode,
              selection,
              resumeSeconds,
              effects: {
                applyManualSourcePick: (providerId, targetEpisode, sourceId) =>
                  selectionCoordinator.applyManualSourcePick(providerId, targetEpisode, sourceId),
                applyEpisodeSelection: (providerId, targetEpisode, streamSelection) =>
                  setPreferredStreamSelection(providerId, targetEpisode, streamSelection),
                prepareStreamSwitchRestart,
              },
            });

            diagnosticsService.record({
              category: "playback",
              message: outcome.diagnostic.message,
              context: {
                ...outcome.diagnostic.context,
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
              },
            });

            return outcome.startIntent;
          };
          const recordTrackOverrideSelected = (
            picked: DecodedTrackSelection,
            selection: StreamSelectionIntent,
          ) => {
            diagnosticsService.record({
              category: "playback",
              message: "Track override selected",
              context: {
                ...buildTrackOverrideDiagnosticContext({
                  section: picked.section,
                  selection,
                }),
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
              },
            });
          };
          const recordStartupMark = (stage: PlaybackStartupStage, activeStream?: StreamInfo) => {
            if (!startupTimeline.mark(stage)) return;
            const snapshot = startupTimeline.snapshot();
            diagnosticsService.record({
              ...playbackCorrelation,
              category: "playback",
              operation: "playback.startup.timeline",
              message: `Playback startup ${stage}`,
              providerId: activeStream?.providerResolveResult?.providerId ?? resolvedProviderId,
              titleId: title.id,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
              context: {
                stage,
                summary: formatPlaybackStartupTimeline(snapshot),
                timeline: snapshot,
                source: summarizeStartupStreamSource(activeStream),
              },
            });
            // Once the first frame lands, emit a single phase-bucketed breakdown
            // (resolve vs prepare vs spawn vs first-frame) naming the dominant
            // cost — this is the autonext "stall" instrument. `autoNext` flags
            // whether this startup was an auto-advance vs a manual start.
            if (stage === "first-progress") {
              const phases = summarizeStartupPhases(snapshot);
              if (phases) {
                diagnosticsService.record({
                  ...playbackCorrelation,
                  category: "playback",
                  operation: "playback.startup.phases",
                  message: `Playback startup phases (${phases.dominant} dominant)`,
                  providerId: resolvedProviderId,
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  context: {
                    autoNext: config.autoNext,
                    breakdown: formatStartupPhaseBreakdown(phases),
                    ...phases,
                  },
                });
              }
            }
          };
          recordStartupMark("episode-bootstrap-started");

          // Warm the catalog-detail cache early so the playback/post-play panels
          // can read it. On resolve we dispatch SET_TITLE_DETAIL so the UI reacts
          // (the rail reads SessionState.titleDetail). Errors are swallowed; the
          // panels fall back to honest placeholders if it never resolves.
          void fetchTitleDetail(title.id, title.type, undefined, {
            externalIds: title.externalIds,
            isAnime: stateManager.getState().mode === "anime" || title.isAnime === true,
          })
            .then((detail) => {
              stateManager.dispatch({
                type: "SET_TITLE_DETAIL",
                titleId: title.id,
                titleType: title.type,
                detail,
              });
              return undefined;
            })
            .catch(() => undefined);

          // Kick off timing fetch in parallel with everything else — IntroDB is a
          // lightweight API call and should resolve well before stream resolution.
          // Uses the configured provider for the warm path; after resolve we re-key
          // on the successful provider when they differ.
          recordStartupMark("timing-fetch-started");
          const configuredTimingProviderId = currentProvider?.metadata.id;
          const timingFetch = this.getPlaybackTimingMetadata(
            title,
            currentEpisode,
            playbackTimingByEpisode,
            resolveController.signal,
            stateManager.getState().mode === "anime",
            configuredTimingProviderId,
            container.diagnosticsService,
          );

          const watchedEntries = historyRepository.listByTitleIdentity(historyTitleLookup);
          const playbackMode = stateManager.getState().mode;
          const isAnimePlayback = playbackMode === "anime";
          const episodeLoadCache = new Map<
            string,
            Promise<Awaited<ReturnType<typeof fetchEpisodes>>>
          >();
          const loadEpisodesOnce = (tmdbId: string, season: number) => {
            const cacheKey = `${tmdbId}:${season}`;
            const cached = episodeLoadCache.get(cacheKey);
            if (cached) return cached;
            const task = fetchEpisodes(tmdbId, season);
            episodeLoadCache.set(cacheKey, task);
            return task;
          };

          stateManager.dispatch({
            type: "SET_PLAYBACK_STATUS",
            status: "loading",
          });
          stateManager.dispatch({ type: "SET_RESOLVE_RETRY_COUNT", count: 0 });
          this.updatePlaybackFeedback(context, {
            detail: "Preparing episode metadata",
            note: "Warming episode names, navigation, and artwork",
          });

          const currentAnimeEpisodesPromise = this.getAnimeEpisodeOptions({
            title,
            mode: playbackMode,
            provider: currentProvider,
            cache: animeEpisodeCatalogByProvider,
            signal: resolveController.signal,
          });
          const downloadedEpisodes = new Set(
            container.offlineAssetService
              .listTitleAssets(title.id)
              .filter((asset) => asset.state === "ready")
              .map((asset) => `${asset.season ?? 1}:${asset.episode ?? 1}`),
          );
          // Continue-path titles rebuilt from history often lack episodeCount;
          // the cached catalog detail knows it, so the picker never collapses
          // to a single "Episode N" entry when the provider list is missing.
          const knownEpisodeCount =
            title.episodeCount ?? peekTitleDetail(title.id, title.type)?.episodeCount;
          const shellEpisodePickerPromise = currentAnimeEpisodesPromise.then(
            (currentAnimeEpisodes) =>
              buildPlaybackEpisodePickerOptions({
                title,
                currentEpisode,
                isAnime: isAnimePlayback,
                animeEpisodeCount: knownEpisodeCount,
                animeEpisodes: currentAnimeEpisodes,
                watchedEntries,
                downloadedEpisodes,
                loadEpisodes: loadEpisodesOnce,
              }),
          );
          const episodeAvailabilityPromise = currentAnimeEpisodesPromise.then(
            (currentAnimeEpisodes) =>
              resolveEpisodeAvailability({
                title,
                currentEpisode,
                isAnime: isAnimePlayback,
                animeEpisodeCount: knownEpisodeCount,
                animeEpisodes: currentAnimeEpisodes,
                loaders: {
                  loadSeasons: fetchSeasons,
                  loadEpisodes: loadEpisodesOnce,
                },
              }),
          );
          const [currentAnimeEpisodes, shellEpisodePicker, episodeAvailability] = await Promise.all(
            [currentAnimeEpisodesPromise, shellEpisodePickerPromise, episodeAvailabilityPromise],
          );
          stateManager.dispatch({
            type: "SET_CURRENT_ANIME_EPISODES",
            episodes: currentAnimeEpisodes ?? null,
          });
          recordStartupMark("episode-context-ready");

          const navigationState = toEpisodeNavigationState(title.type, episodeAvailability, {
            isAnime: stateManager.getState().mode === "anime",
          });
          stateManager.dispatch({
            type: "SET_EPISODE_NAVIGATION",
            navigation: navigationState,
          });
          playerControl.setEpisodeNavigationAvailability(navigationState);

          if (episodeAvailability.tmdbUnavailable) {
            diagnosticsService.record({
              category: "provider",
              message: "TMDB metadata unavailable — episode navigation disabled",
              context: {
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
              },
            });
          }

          this.updatePlaybackFeedback(context, {
            detail: "Resolving provider stream",
            note: "Esc cancel · returns to results",
          });

          const sourceRefreshAction = run.pendingSourceRefreshAction;
          run.pendingSourceRefreshAction = null;
          const recomputeSources = run.pendingRecomputeSources;
          run.pendingRecomputeSources = false;
          await selectionCoordinator.hydrate(currentProvider.metadata.id, currentEpisode);
          const profileContext = {
            mode: stateManager.getState().mode,
            title,
            config,
          };
          const currentPreferredStreamSelection = getPreferredStreamSelection(
            currentProvider.metadata.id,
            currentEpisode,
          );
          const sourceRefreshDecision = sourceRefreshAction
            ? resolveSourceRefreshDecision(sourceRefreshCooldown, {
                action: sourceRefreshAction,
                scope: {
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  providerId: currentProvider.metadata.id,
                  sourceId: currentPreferredStreamSelection.sourceId,
                  streamId: currentPreferredStreamSelection.streamId,
                },
                now: new Date(),
                cooldownMs: 30_000,
              })
            : null;

          if (sourceRefreshDecision?.kind === "cooldown") {
            this.updatePlaybackFeedback(context, {
              detail: sourceRefreshDecision.message,
              note: "The current stream can be reused without another provider lookup.",
            });
            diagnosticsService.record({
              ...playbackCorrelation,
              category: "playback",
              operation: "playback.refresh.cooldown",
              message: sourceRefreshDecision.message,
              providerId: currentProvider.metadata.id,
              titleId: title.id,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
              context: { remainingMs: sourceRefreshDecision.remainingMs },
            });
          } else if (sourceRefreshDecision) {
            diagnosticsService.record({
              ...playbackCorrelation,
              category: "playback",
              operation:
                sourceRefreshDecision.kind === "recover"
                  ? "playback.recover.requested"
                  : "playback.refresh.requested",
              message:
                sourceRefreshDecision.kind === "recover"
                  ? "Recovering current provider source"
                  : "Refreshing current provider source",
              providerId: currentProvider.metadata.id,
              titleId: title.id,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
            });
          }

          // Use a prefetched bundle (resolve + optional subtitle prep during near-EOF)
          // or fall back to a full provider resolve. Explicit refresh/recover bypasses
          // prefetch so it can ask the provider for a fresh source.
          const buildPrefetchTarget = (
            nextEpisodeIntent: EpisodeInfo,
            providerId: string,
          ): EpisodePrefetchTarget => {
            const targetSelection = getPreferredStreamSelection(providerId, nextEpisodeIntent);
            return {
              titleId: title.id,
              episode: nextEpisodeIntent,
              providerId,
              sourceId: targetSelection.sourceId ?? undefined,
              streamId: targetSelection.streamId ?? undefined,
              audioPreference: playbackAudioPreference(profileContext),
              qualityPreference: playbackQualityPreference(profileContext),
              startupPriority: config.startupPriority,
              subtitlePreference: playbackSubtitlePreference(profileContext),
            };
          };
          const consumedBundle = sourceRefreshDecision
            ? null
            : episodePrefetch.takeReadyFor(
                buildPrefetchTarget(currentEpisode, currentProvider.metadata.id),
              );
          const prefetchWasPrepared = consumedBundle?.prepared === true;

          let stream: StreamInfo | null = consumedBundle?.stream ?? null;
          let streamProvenance: RecentPlaybackStreamProvenance = consumedBundle
            ? "prefetch"
            : "fresh";
          let resolveAttempts: readonly ResolveAttempt<StreamInfo>[] = [];
          if (stream) recordStartupMark("resolve-complete", stream);

          const resolveTrace = createResolveTraceStub({
            title,
            episode: currentEpisode,
            providerId: currentProvider.metadata.id,
            mode: stateManager.getState().mode,
          });
          diagnosticsService.record({
            ...playbackCorrelation,
            category: "provider",
            message: "Resolve trace started",
            context: { trace: resolveTrace },
          });

          if (consumedBundle) {
            resolvedProviderId = consumedBundle.resolvedProviderId;
            logger.info("Using prefetched stream for episode", {
              titleId: title.id,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
              prepared: prefetchWasPrepared,
              resolvedProviderId,
            });
            diagnosticsService.record({
              ...playbackCorrelation,
              category: "provider",
              message: prefetchWasPrepared
                ? "Using prefetched prepared stream"
                : "Using prefetched stream",
              context: {
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
                prepared: prefetchWasPrepared,
                resolvedProviderId,
              },
            });
          }

          const providerSwitchSeq = stateManager.getState().providerSwitchSeq;
          const pendingUserProviderSwitch = providerSwitchSeq !== consumedProviderSwitchSeq;
          if (pendingUserProviderSwitch) {
            consumedProviderSwitchSeq = providerSwitchSeq;
            run.sessionSoftProviderId = null;
            stream = null;
          }

          // Check in-memory cache for recently played episodes (backward navigation).
          // This lets P-navigation reuse the exact same StreamInfo without any
          // provider resolve, cache lookup, or health check.
          if (!stream && !sourceRefreshDecision) {
            const recentKey = recentPlaybackStreamKey(title.id, currentEpisode);
            const recent = recentEpisodeStreams.get(recentKey);
            if (
              recentPlaybackStreamMatchesProvider(recent, currentProvider.metadata.id) &&
              recentStreamMatchesPreferred(recent, currentProvider.metadata.id, currentEpisode)
            ) {
              stream = recent.stream;
              resolvedProviderId = recent.resolvedProviderId;
              streamProvenance = recent.provenance;
              diagnosticsService.record({
                ...playbackCorrelation,
                category: "cache",
                operation: "playback.stream.reused",
                message: "Using in-memory recent episode stream (backward navigation)",
                providerId: recent.resolvedProviderId,
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
                context: {
                  provenance: "recent-memory",
                  originalProvenance: recent.provenance,
                  selectedProviderId: recent.selectedProviderId,
                  resolvedProviderId: recent.resolvedProviderId,
                },
              });
            }
          }

          if (!stream && !sourceRefreshDecision) {
            const localResolution = await resolveLocalEpisodePlayback(
              container,
              title,
              currentEpisode,
              {
                entrypoint: "online-search",
                forceOnline: run.episodePlaybackSourceOverride === "online",
                forceLocal: run.episodePlaybackSourceOverride === "local",
              },
            );
            run.episodePlaybackSourceOverride = null;
            if (localResolution) {
              stream = localResolution.stream;
              streamProvenance = "local";
              run.localEpisodeTiming = localResolution.timing;
              run.localPlaybackJobId = localResolution.jobId;
              diagnosticsService.record({
                ...playbackCorrelation,
                category: "playback",
                operation: "playback.source.local",
                message: "Using verified local file for episode playback",
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
                context: { jobId: localResolution.jobId },
              });
              recordStartupMark("resolve-complete", stream);
            }
          }

          if (!stream) {
            recordStartupMark("resolve-started");
            const resolvePolicy = resolvePlaybackResolvePolicy({
              recomputeSources,
              pendingUserProviderSwitch,
              sourceRefreshDecision,
              configuredRecoveryMode: config.recoveryMode,
            });
            if (resolvePolicy.shouldInvalidateSuspectResolveState) {
              await invalidateEpisodePlaybackCaches({
                cacheStore,
                sourceInventory: container.sourceInventory,
                providerId: currentProvider.metadata.id,
                title,
                episode: currentEpisode,
                mode: stateManager.getState().mode,
                config,
                selectedSourceId: currentPreferredStreamSelection.sourceId,
                selectedStreamId: currentPreferredStreamSelection.streamId,
              });
            }
            const titlePreferredProviderId = resolveTitleProviderPreference(
              config.getRaw(),
              title.id,
            );
            const resolveResult = await container.playbackResolveWork.resolve(
              {
                title,
                episode: currentEpisode,
                mode: stateManager.getState().mode,
                providerId: currentProvider.metadata.id,
                audioPreference: playbackAudioPreference(profileContext),
                subtitlePreference: playbackSubtitlePreference(profileContext),
                qualityPreference: playbackQualityPreference(profileContext),
                startupPriority: config.startupPriority,
                favoriteSourceNames: config.favoriteSources,
                selectedSourceId: currentPreferredStreamSelection.sourceId ?? undefined,
                selectedStreamId: currentPreferredStreamSelection.streamId ?? undefined,
                recoveryMode: resolvePolicy.recoveryMode,
                preferFreshStream: resolvePolicy.preferFreshStream,
                forceHealthCheck: resolvePolicy.forceHealthCheck,
                preserveCachedStreamOnFreshFailure:
                  resolvePolicy.preserveCachedStreamOnFreshFailure,
                ignoreTitleHealthSuggestion: resolvePolicy.ignoreTitleHealthSuggestion,
                ignoreProviderHealth: resolvePolicy.ignoreProviderHealth,
                resolveIntent: resolvePolicy.resolveIntent,
                blockedStreamUrls: deadStreamUrls.list(deadStreamScope),
                signal: resolveController.signal,
                correlation: playbackCorrelation,
                onFeedback: (feedback) => {
                  if (resolveController.signal.aborted) return;
                  this.updatePlaybackFeedback(context, feedback);
                },
                onEvent: (event) => {
                  if (event.type === "cache-hit" || event.type === "cache-miss") {
                    const hit = event.type === "cache-hit";
                    if (hit) {
                      logger.info("Provider resolve cache hit", {
                        provider: event.providerId,
                        titleId: title.id,
                        season: currentEpisode.season,
                        episode: currentEpisode.episode,
                      });
                    }
                    diagnosticsService.record({
                      ...playbackCorrelation,
                      category: "cache",
                      message: hit ? "Provider resolve cache hit" : "Provider resolve cache miss",
                      context: {
                        provider: event.providerId,
                        titleId: title.id,
                        season: currentEpisode.season,
                        episode: currentEpisode.episode,
                      },
                    });
                    return;
                  }

                  if (event.type === "fresh-source-failed-using-cache") {
                    this.updatePlaybackFeedback(context, {
                      detail: "No fresher source found. Continuing current stream.",
                      note: "The cached stream stayed available, so playback can resume.",
                    });
                    return;
                  }

                  if (event.type === "title-provider-suggestion") {
                    const suggestedName =
                      providerRegistry.get(event.suggestedProviderId)?.metadata.name ??
                      event.suggestedProviderId;
                    this.updatePlaybackFeedback(context, {
                      note: `VidKing struggled on this title before. ${suggestedName} worked — switch providers or retry VidKing.`,
                    });
                    return;
                  }

                  if (event.type === "cache-health-check") {
                    diagnosticsService.record({
                      ...playbackCorrelation,
                      category: "cache",
                      message: event.healthy
                        ? "Cached stream health check passed"
                        : "Cached stream health check failed",
                      context: {
                        provider: event.providerId,
                        titleId: title.id,
                        season: currentEpisode.season,
                        episode: currentEpisode.episode,
                        strategy: event.strategy,
                        ageMs: event.ageMs,
                      },
                    });
                    return;
                  }

                  if (event.type === "attempt") {
                    stateManager.dispatch({
                      type: "SET_RESOLVE_RETRY_COUNT",
                      count: Math.max(0, event.attempt - 1),
                    });
                    this.updatePlaybackFeedback(context, {
                      detail: describeProviderResolveAttemptDetail(event),
                      note: describeProviderResolveAttemptNote(event),
                    });
                    return;
                  }

                  if (event.type === "failure") {
                    this.updatePlaybackFeedback(context, {
                      detail: event.retryable
                        ? `Recoverable provider issue (${event.attempt}/${event.maxAttempts})`
                        : "Provider returned a non-recoverable issue",
                      note: event.issue,
                    });
                  } else if (event.type === "cache-stale") {
                    this.updatePlaybackFeedback(context, {
                      detail: "Cached stream expired, refetching…",
                      note: null,
                    });
                  }
                },
              },
              {
                intentKind: sourceRefreshDecision?.kind === "recover" ? "recovery" : "playback",
                budgetLane: "user-blocking",
              },
            );

            stream = resolveResult.stream;
            resolvedProviderId = resolveResult.providerId;
            observeResolveNetworkOutcome(container, resolveResult);
            if (
              stream &&
              pendingUserProviderSwitch &&
              titlePreferredProviderId &&
              resolvedProviderId !== titlePreferredProviderId
            ) {
              const preferredName =
                providerRegistry.get(titlePreferredProviderId)?.metadata.name ??
                titlePreferredProviderId;
              const actualName =
                providerRegistry.get(resolvedProviderId)?.metadata.name ?? resolvedProviderId;
              diagnosticsService.record({
                ...playbackCorrelation,
                category: "provider",
                level: "warn",
                message: "Rejected provider fallback because a per-title preference is set",
                context: {
                  titleId: title.id,
                  preferredProviderId: titlePreferredProviderId,
                  resolvedProviderId,
                },
              });
              this.updatePlaybackFeedback(context, {
                detail: `${preferredName} did not resolve for this episode`,
                note: `Got ${actualName} instead. Use /recompute or switch provider.`,
              });
              stream = null;
            }
            streamProvenance =
              resolveResult.provenance === "prefetched"
                ? "prefetch"
                : resolveResult.provenance.startsWith("cache")
                  ? "cache"
                  : resolveResult.providerId !== currentProvider.metadata.id
                    ? "fallback"
                    : "fresh";
            resolveAttempts = resolveResult.attempts;
            if (stream) recordStartupMark("resolve-complete", stream);

            for (const [attemptIndex, attempt] of resolveAttempts.entries()) {
              diagnosticsService.record({
                ...playbackCorrelation,
                category: "provider",
                message: attempt.stream
                  ? "Provider resolve attempt succeeded"
                  : "Provider resolve attempt failed",
                context: {
                  stage: "provider-resolve",
                  attempt: attemptIndex + 1,
                  provider: attempt.providerId,
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  hasTrace: Boolean(attempt.result?.trace),
                  failure: attempt.failure ?? null,
                },
              });
            }

            const hop = decideSoftFallbackOnResolve({
              configuredProviderId: currentProvider.metadata.id,
              resolvedProviderId,
            });
            if (hop.kind === "session-soft-hop") {
              logger.info("Resolved stream with fallback provider", {
                from: currentProvider.metadata.id,
                fallback: hop.providerId,
              });
              run.sessionSoftProviderId = hop.providerId;
              this.playbackLedger?.alignProvider(hop.providerId);
              const fallbackName =
                providerRegistry.get(hop.providerId)?.metadata.name ?? hop.providerId;
              this.updatePlaybackFeedback(context, {
                note: `Using ${fallbackName} for this session. /provider to switch back, then /recompute.`,
              });
            } else if (pendingUserProviderSwitch) {
              const streamProviderId = resolveStreamProviderId(stream);
              if (streamProviderId && streamProviderId === configuredProviderId) {
                this.updatePlaybackFeedback(context, {
                  note: `Resolving via ${providerRegistry.get(configuredProviderId)?.metadata.name ?? configuredProviderId}.`,
                });
              }
            }

            if (stream?.providerResolveResult) {
              diagnosticsService.record({
                ...playbackCorrelation,
                category: "provider",
                message: "Provider resolve trace completed",
                context: {
                  trace: stream.providerResolveResult.trace,
                  streamCandidates: stream.providerResolveResult.streams.length,
                  subtitleCandidates: stream.providerResolveResult.subtitles.length,
                  cachePolicy: stream.providerResolveResult.cachePolicy,
                },
              });
            }
          }

          if (stream) recordStartupMark("resolve-complete", stream);

          // Esc/cancel during resolve must not hand off a late-arriving stream to mpv.
          if (stream && resolveController.signal.aborted && !context.signal.aborted) {
            stream = null;
          }

          // TypeScript cannot narrow `stream` across the conditional mutation above.
          if (!stream) {
            workControl.setActive(null);
            const resolveAborted = resolveController.signal.aborted && !context.signal.aborted;
            const streamSwitchAction = resolveAborted ? playerControl.consumeLastAction() : null;
            const streamSwitchSelection =
              streamSwitchAction === "pick-source" ||
              streamSwitchAction === "pick-stream" ||
              streamSwitchAction === "pick-quality"
                ? playerControl.consumePendingStreamSelection()
                : null;
            const hasCompatibleFallbackProvider =
              resolveAborted && resolveAbortIntent === "fallback"
                ? providerRegistry
                    .getCompatible(title, stateManager.getState().mode)
                    .some((candidate) => candidate.metadata.id !== currentProvider.metadata.id)
                : false;

            let problemAction: "dismiss" | "retry" | null = null;
            if (!resolveAborted) {
              const problem = buildProviderResolveProblem({
                attempts: resolveAttempts,
                capabilitySnapshot: container.capabilitySnapshot,
              });
              run.playbackSession = this.transitionPlaybackSession(
                context,
                run.playbackSession,
                "failure-shown",
                {
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  cause: problem.cause,
                },
              );
              problemAction = await this.showPlaybackProblem(context, problem);
            }

            const iterationDirective = planEpisodeIterationDirective({
              streamResolved: false,
              resolveAborted,
              sessionAborted: context.signal.aborted,
              streamSwitchSelection,
              resolveAbortIntent,
              hasCompatibleFallbackProvider,
              problemAction,
            });

            if (iterationDirective.kind === "continue") {
              continue;
            }

            if (iterationDirective.kind === "restart") {
              if (
                iterationDirective.reason === "stream-switch-during-resolve" &&
                streamSwitchSelection
              ) {
                await setPreferredStreamSelection(
                  currentProvider.metadata.id,
                  currentEpisode,
                  streamSwitchSelection,
                );
                await prepareStreamSwitchRestart(currentEpisode);
                diagnosticsService.record({
                  ...playbackCorrelation,
                  category: "playback",
                  message: "Stream selection applied during bootstrap resolve",
                  providerId: currentProvider.metadata.id,
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  context: {
                    action: streamSwitchAction,
                    sourceId: streamSwitchSelection.sourceId,
                    streamId: streamSwitchSelection.streamId,
                  },
                });
                continue;
              }

              if (iterationDirective.reason === "provider-fallback-skip") {
                const fallback = providerRegistry
                  .getCompatible(title, stateManager.getState().mode)
                  .find((candidate) => candidate.metadata.id !== currentProvider.metadata.id);
                if (fallback) {
                  run.sessionSoftProviderId = null;
                  stateManager.dispatch({ type: "SET_PROVIDER", provider: fallback.metadata.id });
                  this.updatePlaybackFeedback(context, {
                    detail: `Trying ${fallback.metadata.name ?? fallback.metadata.id}…`,
                    note: "Fallback provider selected for the rest of this session",
                  });
                  diagnosticsService.record({
                    category: "provider",
                    message: "Skipping current provider during playback bootstrap",
                    context: {
                      from: currentProvider.metadata.id,
                      fallback: fallback.metadata.id,
                      titleId: title.id,
                      season: currentEpisode.season,
                      episode: currentEpisode.episode,
                    },
                  });
                  continue;
                }
              }

              if (iterationDirective.reason === "resolve-retry") {
                run.pendingSourceRefreshAction = "recover";
                run.pendingRecomputeSources = true;
                run.autoSourceRecoverAttempts = 0;
                invalidateRecentEpisodeStream(currentEpisode);
                this.updatePlaybackFeedback(context, {
                  detail: "Retrying with fresh provider sources…",
                  note: "Cached failures and stale source inventory are bypassed for this attempt.",
                });
                continue;
              }
            }

            if (resolveAborted) {
              stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
              stateManager.dispatch({ type: "SET_STREAM", stream: null });
              this.updatePlaybackFeedback(context, { detail: null, note: null });
              await dismissMpvTransitionOverlay(playerControl);
            } else {
              stateManager.dispatch({ type: "SET_STREAM", stream: null });
            }
            return { status: "success", value: "back_to_results" };
          }

          if (stream && streamProvenance !== "local") {
            const hop = decideSoftFallbackOnResolve({
              configuredProviderId: currentProvider.metadata.id,
              resolvedProviderId,
            });
            if (hop.kind === "session-soft-hop" && run.sessionSoftProviderId !== hop.providerId) {
              logger.info("Resolved stream with fallback provider", {
                from: currentProvider.metadata.id,
                fallback: hop.providerId,
              });
              run.sessionSoftProviderId = hop.providerId;
              this.playbackLedger?.alignProvider(hop.providerId);
              const fallbackName =
                providerRegistry.get(hop.providerId)?.metadata.name ?? hop.providerId;
              this.updatePlaybackFeedback(context, {
                note: `Using ${fallbackName} for this session. /provider to switch back, then /recompute.`,
              });
            }
          }

          const providerHandoff = resolvePlaybackProviderHandoff({
            configuredProviderId: currentProvider.metadata.id,
            successfulProviderId: resolvedProviderId,
          });

          stream = applyPreferredStreamSelection(
            stream,
            getPreferredStreamSelection(currentProvider.metadata.id, currentEpisode),
          );

          // Await timing — stream resolve takes much longer so this is nearly free.
          // If IntroDB timed out and returned null, schedule a background retry that
          // injects timing into the running player once it arrives.
          recordStartupMark("timing-wait-started", stream);
          const successfulTimingProviderId = providerHandoff.successfulProviderId;
          const fetchedPlaybackTiming =
            run.localEpisodeTiming ??
            (successfulTimingProviderId === configuredTimingProviderId
              ? await timingFetch
              : await this.getPlaybackTimingMetadata(
                  title,
                  currentEpisode,
                  playbackTimingByEpisode,
                  resolveController.signal,
                  stateManager.getState().mode === "anime",
                  successfulTimingProviderId,
                  container.diagnosticsService,
                ));
          run.localEpisodeTiming = null;
          recordStartupMark("timing-ready", stream);
          const playbackTiming = mergeTimingMetadata(
            fetchedPlaybackTiming,
            extractProviderNativeTiming(stream, title),
          );
          if (playbackTiming) {
            const timingCacheKey = playbackTimingCacheKey(
              title,
              currentEpisode,
              successfulTimingProviderId,
            );
            playbackTimingByEpisode.set(timingCacheKey, playbackTiming);
          }
          // effectiveTiming.current tracks the best timing we have — updated in-place
          // if the background retry resolves while the episode is playing, so all
          // post-playback decisions (history, autoNext, result classification) use it.
          const effectiveTiming = { current: playbackTiming };
          if (!playbackTiming) {
            runBackgroundTask({
              task: "playback.retryTiming",
              category: "playback",
              diagnostics: container.diagnosticsService,
              context: {
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
                providerId: successfulTimingProviderId,
              },
              run: () =>
                this.retryTimingInBackground(
                  title,
                  currentEpisode,
                  container,
                  effectiveTiming,
                  playbackTimingByEpisode,
                  stateManager.getState().mode === "anime",
                  successfulTimingProviderId,
                ),
            });
          }

          const preparedStream =
            prefetchWasPrepared || streamProvenance === "local"
              ? stream
              : await this.preparePlaybackStream(stream, title, currentEpisode, context);
          recordStartupMark("stream-prepared", preparedStream);
          stateManager.dispatch({ type: "SET_STREAM", stream: preparedStream });

          const episodeKey = `${title.id}:${currentEpisode.season}:${currentEpisode.episode}`;
          recentEpisodeStreams.set(episodeKey, {
            stream: preparedStream,
            selectedProviderId: currentProvider.metadata.id,
            resolvedProviderId,
            provenance: streamProvenance,
          });
          if (recentEpisodeStreams.size > 5) {
            const first = recentEpisodeStreams.keys().next().value;
            if (first !== undefined) recentEpisodeStreams.delete(first);
          }
          stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "ready" });
          run.playbackSession = this.transitionPlaybackSession(
            context,
            run.playbackSession,
            "stream-ready",
            {
              titleId: title.id,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
              provider: resolvedProviderId,
            },
          );

          // Play in MPV — consume the pending resume position on the first play only.
          // Pass loading handle so playStream can update it in-place (no shell flicker).
          const startIntent = run.pendingStart;
          run.pendingStart = startFromBeginning();

          let prefetchedRecommendationItems: readonly SearchResult[] | null = null;
          let nextPrefetchProgress: EpisodePrefetchProgress = {};
          const buildNextPrefetchTarget = (): EpisodePrefetchTarget | null => {
            const nextEp = episodeAvailability.nextEpisode;
            if (!nextEp) return null;
            const prefetchProviderId = providerHandoff.nextEpisodeProviderId;
            if (!providerRegistry.get(prefetchProviderId)) return null;
            return buildPrefetchTarget(nextEp, prefetchProviderId);
          };
          const handoffNextEpisodePrefetch = async (
            target: EpisodePrefetchTarget,
            operation: "playback.prefetch-wait" | "post-playback.autonext.prefetch-wait",
          ) => {
            await adoptEpisodePrefetchBundle({
              handle: episodePrefetch,
              target,
              run: (signal) => runNextEpisodePrefetch(signal, target),
              getProgress: () => nextPrefetchProgress,
              onWaiting: () =>
                this.updatePlaybackFeedback(context, {
                  detail: "Preparing next episode",
                  note: "Still preparing a source in the background",
                }),
              recordWait: (wait) => {
                diagnosticsService.record({
                  category: "playback",
                  operation,
                  message: wait.bundle
                    ? "Prefetch completed during episode handoff wait"
                    : "Prefetch grace window elapsed during episode handoff",
                  context: {
                    titleId: title.id,
                    nextSeason: target.episode.season,
                    nextEpisode: target.episode.episode,
                    completed: wait.bundle !== null,
                    waitResult: wait.outcome,
                    waitedMs: wait.waitedMs,
                    prepared: wait.bundle?.prepared ?? false,
                  },
                });
              },
            });
          };
          const runNextEpisodePrefetch = (signal: AbortSignal, target: EpisodePrefetchTarget) => {
            const nextEp = target.episode;
            const prefetchMetadata = providerRegistry.get(target.providerId);
            if (!prefetchMetadata) {
              return Promise.resolve(null);
            }
            return this.resolveEpisodePrefetchBundle(context, {
              title,
              nextEpisode: nextEp,
              providerId: prefetchMetadata.metadata.id,
              target,
              onProgress: (progress) => {
                nextPrefetchProgress = { ...nextPrefetchProgress, ...progress };
              },
              signal,
            })
              .then((bundle) => {
                if (bundle) {
                  diagnosticsService.record({
                    category: "playback",
                    message: "Prefetch resolved successfully",
                    context: {
                      titleId: title.id,
                      nextSeason: nextEp.season,
                      nextEpisode: nextEp.episode,
                      providerId: prefetchMetadata.metadata.id,
                      resolvedProviderId: bundle.resolvedProviderId,
                      prepared: bundle.prepared,
                    },
                  });
                }
                return bundle;
              })
              .catch((err) => {
                diagnosticsService.record({
                  category: "playback",
                  level: "warn",
                  message: "Prefetch resolve failed",
                  context: {
                    titleId: title.id,
                    nextSeason: nextEp.season,
                    nextEpisode: nextEp.episode,
                    providerId: prefetchMetadata.metadata.id,
                    error: err instanceof Error ? err.message : String(err),
                  },
                });
                return null;
              });
          };
          const maybePrefetchNext = async () => {
            if (container.config.powerSaverMode) {
              return;
            }
            if (
              !isEpisodePrefetchEligible({
                titleType: title.type,
                hasNextEpisode: Boolean(episodeAvailability.nextEpisode),
                stopAfterCurrent: run.playbackSession.stopAfterCurrent,
                sessionMode: run.playbackSession.mode,
                autoplayPaused: run.playbackSession.autoplayPaused,
              })
            ) {
              return;
            }
            const nextEp = episodeAvailability.nextEpisode;
            const prefetchProviderId = providerHandoff.nextEpisodeProviderId;
            const prefetchMetadata = providerRegistry.get(prefetchProviderId);
            if (nextEp && prefetchMetadata) {
              await selectionCoordinator.hydrate(prefetchMetadata.metadata.id, nextEp);
            }
            const target = buildNextPrefetchTarget();
            if (!target) return;
            nextPrefetchProgress = {};
            episodePrefetch.schedule(target, (signal) => runNextEpisodePrefetch(signal, target));

            if (
              container.config.recommendationRailEnabled &&
              prefetchedRecommendationItems === null &&
              stateManager.getState().mode !== "youtube" &&
              !title.id.startsWith("youtube")
            ) {
              container.backgroundWorkScheduler.enqueue({
                id: `recommendation-prefetch:${title.type}:${title.id}`,
                lane: "recommendation-warm",
                signal: context.signal,
                run: async () => {
                  const section = await container.recommendationService.getForTitle(
                    title.id,
                    title.type,
                  );
                  prefetchedRecommendationItems = section.items.filter(
                    (item) => item.title.trim().length > 0,
                  );
                },
              });
              void container.backgroundWorkScheduler.drain();
            }
          };

          run.playbackSession = this.transitionPlaybackSession(
            context,
            run.playbackSession,
            "playback-started",
            {
              titleId: title.id,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
              provider: resolvedProviderId,
            },
          );

          if (context.signal.aborted) {
            stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
            this.releasePlaybackLedgerWithoutPersist();
            await container.player.releasePersistentSession();
            return { status: "cancelled" };
          }

          let result: PlaybackResult;
          try {
            queueAttempt?.setStage("player-launch");
            result = await this.playStream(
              preparedStream,
              title,
              currentEpisode,
              context,
              startIntent.startAt,
              startIntent.resumePromptAt,
              run.playbackSession.mode,
              playbackTiming,
              maybePrefetchNext,
              startIntent.suppressResumePrompt,
              playbackCorrelation,
              (stage) => recordStartupMark(stage, preparedStream),
              providerHandoff.successfulProviderId,
              playbackIterationAbort.signal,
              () => {
                queueAttempt?.acknowledgeStarted();
              },
            );
          } catch (error) {
            if (error instanceof PlaybackAbortedError || context.signal.aborted) {
              stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
              this.releasePlaybackLedgerWithoutPersist();
              await container.player.releasePersistentSession();
              return { status: "cancelled" };
            }
            throw error;
          }

          if (context.signal.aborted) {
            stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
            this.releasePlaybackLedgerWithoutPersist();
            await container.player.releasePersistentSession();
            return { status: "cancelled" };
          }
          run.playbackSession = this.transitionPlaybackSession(
            context,
            run.playbackSession,
            "playback-ended",
            {
              titleId: title.id,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
              provider: resolvedProviderId,
              endReason: result.endReason,
              suspectedDeadStream: result.suspectedDeadStream === true,
            },
          );

          // Save history — use effectiveTiming.current so that a background retry
          // that completed during playback is reflected in completion status.
          const quitThresholdMode = config.quitNearEndThresholdMode;
          if (shouldPersistHistory(result, effectiveTiming.current, quitThresholdMode)) {
            const didComplete = didPlaybackReachCompletionThreshold(
              result,
              effectiveTiming.current,
              quitThresholdMode,
            );
            const evidence = trustedProgressFromPlaybackResult(result);
            const decision = evaluateProgressEngage(evidence, {
              reachedCompletionThreshold: didComplete,
            });
            let historyTimestamp = toHistoryTimestamp(
              result,
              effectiveTiming.current,
              quitThresholdMode,
            );
            const persistedKind = classifyPersistedKind(title, stateManager.getState().mode, {
              providerId: resolvedProviderId,
            });
            const historyTitleId = resolveTitleHistoryLookupId(title, stateManager.getState().mode);
            const episodeIdentity =
              title.type === "series"
                ? {
                    season: currentEpisode.season,
                    episode: currentEpisode.episode,
                    ...(currentEpisode.absoluteEpisode !== undefined
                      ? { absoluteEpisode: currentEpisode.absoluteEpisode }
                      : {}),
                  }
                : undefined;
            const titleIdentity = {
              id: title.id,
              kind: persistedKind,
              title: title.name,
              externalIds: enrichExternalIdsWithVideoMeta(
                title.externalIds,
                stateManager.getState().videoMeta,
              ),
            };
            if (decision.isDidNotStart) {
              const existingProgress = container.historyRepository.getProgressForTitleIdentity(
                titleIdentity,
                episodeIdentity,
              );
              if (existingProgress && existingProgress.positionSeconds > 0) {
                historyTimestamp = existingProgress.positionSeconds;
              }
            }
            const existingProgressForBump = container.historyRepository.getProgressForTitleIdentity(
              titleIdentity,
              episodeIdentity,
            );
            const lastWatchedAt = decision.shouldBumpLastWatched
              ? new Date().toISOString()
              : (existingProgressForBump?.lastWatchedAt ??
                existingProgressForBump?.updatedAt ??
                null);
            if (this.playbackLedger) {
              this.playbackLedger.finalize({
                positionSeconds: historyTimestamp,
                durationSeconds: result.duration,
                completed: didComplete,
                providerId: resolvedProviderId,
                posterUrl: title.posterUrl,
                bumpLastWatched: decision.shouldBumpLastWatched,
              });
              this.playbackLedger = null;
              this.unregisterActiveCheckpoint?.();
              this.unregisterActiveCheckpoint = null;
            } else {
              container.historyRepository.upsertProgress({
                title: titleIdentity,
                episode: episodeIdentity,
                positionSeconds: historyTimestamp,
                durationSeconds: result.duration,
                completed: didComplete,
                watchedSeconds: didComplete ? result.duration : historyTimestamp,
                lastWatchedAt,
                completedAt: didComplete ? new Date().toISOString() : null,
                providerId: resolvedProviderId,
                posterUrl: title.posterUrl,
                updatedAt: new Date().toISOString(),
              });
            }
            await promoteSoftFallbackAfterEngage(container, {
              title,
              mode: stateManager.getState().mode,
              sessionSoftProviderId: run.sessionSoftProviderId,
              configuredProviderId: currentProvider.metadata.id,
              engaged: decision.isEngaged,
            });
            const savedHistoryRow = container.historyRepository.getLatestForTitle(historyTitleId);
            enqueueReleaseReconciliation(
              container,
              savedHistoryRow ? [savedHistoryRow] : [],
              "post-playback",
              context.signal,
            );
            const providerSuggestion = container.titleProviderHealth.getSwitchSuggestion(
              title.id,
              currentProvider.metadata.id,
            );
            if (providerSuggestion) {
              this.updatePlaybackFeedback(context, {
                note: `${providerSuggestion.providerId} struggled with this title. ${providerSuggestion.suggestedProviderId} worked; choose it from providers for this title.`,
              });
              diagnosticsService.record({
                category: "provider",
                operation: "provider.title-health.suggestion",
                message: "Title-scoped provider switch suggestion available at episode boundary",
                context: {
                  titleId: title.id,
                  providerId: providerSuggestion.providerId,
                  suggestedProviderId: providerSuggestion.suggestedProviderId,
                },
              });
            }
            if (didComplete) {
              const epStr =
                title.type === "series"
                  ? ` S${String(currentEpisode.season).padStart(2, "0")}E${String(currentEpisode.episode).padStart(2, "0")}`
                  : "";
              this.updatePlaybackFeedback(context, {
                note: `✓ ${title.name}${epStr} · episode complete`,
              });
              if (streamProvenance === "local" && run.localPlaybackJobId) {
                container.offlineRunwayService.enqueueEvaluation(
                  title.id,
                  "offline-playback-complete",
                );
              }
            }
          } else {
            this.releasePlaybackLedgerWithoutPersist();
            diagnosticsService.record({
              category: "playback",
              message: "Skipped history save",
              context: {
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
                watchedSeconds: result.watchedSeconds,
                duration: result.duration,
                endReason: result.endReason,
              },
            });
          }

          // One-time sync nudge: show on first episode completion if no sync is connected.
          if (
            shouldPersistHistory(result, effectiveTiming.current, quitThresholdMode) &&
            !config.syncNudgeDismissedAt &&
            container.syncService.getConnectedAdapters().length === 0
          ) {
            this.updatePlaybackFeedback(context, {
              note: "Connect AniList or TMDB to sync progress. /sync to set up  ·  [d] dismiss",
            });
          }

          const shouldInvalidateStreamCache =
            result.endReason === "error" ||
            result.suspectedDeadStream === true ||
            didPlaybackFailToStart(result);
          if (shouldInvalidateStreamCache) {
            const invalidateProviderId = providerHandoff.successfulProviderId;
            const selectedResolveStream = preparedStream.providerResolveResult?.streams.find(
              (candidate) =>
                candidate.id === preparedStream.providerResolveResult?.selectedStreamId,
            );
            deadStreamUrls.record(
              playbackDeadStreamScopeKey({
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
                providerId: invalidateProviderId,
              }),
              preparedStream.url,
            );
            await invalidateEpisodePlaybackCaches({
              cacheStore,
              sourceInventory: container.sourceInventory,
              providerId: invalidateProviderId,
              title,
              episode: currentEpisode,
              mode: stateManager.getState().mode,
              config,
              selectedSourceId: selectedResolveStream?.sourceId,
              selectedStreamId: preparedStream.providerResolveResult?.selectedStreamId,
            });
            invalidateRecentEpisodeStream(currentEpisode);
            if (result.suspectedDeadStream === true) {
              container.titleProviderHealth.recordFailure(
                title.id,
                invalidateProviderId,
                undefined,
                "dead-stream",
              );
            }
            diagnosticsService.record({
              category: "playback",
              message: result.suspectedDeadStream
                ? "Stream ended early — cached URL invalidated for next resolve"
                : "Stream died — cache entry invalidated for next resolve",
              context: {
                provider: invalidateProviderId,
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
                exitCode: result.playerExitCode,
                exitSignal: result.playerExitSignal,
                suspectedDeadStream: result.suspectedDeadStream === true,
                wasPrefetched: Boolean(consumedBundle),
              },
            });
          }

          const playbackControlAction = playerControl.consumeLastAction();
          const confirmedStreamSelection =
            playbackControlAction === "pick-source" ||
            playbackControlAction === "pick-stream" ||
            playbackControlAction === "pick-quality"
              ? playerControl.consumePendingStreamSelection()
              : null;
          const confirmedEpisodeSelection =
            playbackControlAction === "pick-episode"
              ? playerControl.consumePendingEpisodeSelection()
              : null;
          run.playbackSession = syncPlaybackSessionState(run.playbackSession, {
            autoplaySessionPaused: stateManager.getState().autoplaySessionPaused,
            stopAfterCurrent: stateManager.getState().stopAfterCurrent,
          });
          const playbackDecision = resolvePlaybackResultDecision({
            result,
            controlAction: playbackControlAction,
            session: run.playbackSession,
            timing: effectiveTiming.current,
            endPolicy: {
              quitNearEndBehavior: config.quitNearEndBehavior,
              quitNearEndThresholdMode: config.quitNearEndThresholdMode,
            },
          });
          run.playbackSession = playbackDecision.session;
          // The "interrupted" pause is an internal, per-episode guard so quitting
          // mid-episode does not immediately auto-advance. It is deliberately NOT
          // pushed into shell state: doing so rendered "autoplay paused" as if the
          // user's session preference had changed just because they closed mpv.
          // Only an explicit toggle changes the visible autoplay setting.
          let shouldAutoFallbackProvider = playbackDecision.shouldFallbackProvider;
          if (playbackDecision.shouldRefreshSource) {
            const isExplicitSourceRefresh =
              playbackControlAction === "refresh" || playbackControlAction === "recover";
            const isAutoSourceRecover =
              !isExplicitSourceRefresh &&
              (result.suspectedDeadStream === true || didPlaybackFailToStart(result));

            const selectedResolveStream = preparedStream.providerResolveResult?.streams.find(
              (candidate) =>
                candidate.id === preparedStream.providerResolveResult?.selectedStreamId,
            );
            const currentSourceId =
              selectedResolveStream?.sourceId ??
              getPreferredStreamSelection(resolvedProviderId, currentEpisode).sourceId ??
              null;

            let skipRefreshContinue = false;

            if (
              isAutoSourceRecover &&
              run.autoSourceRecoverAttempts >= MAX_AUTO_SOURCE_RECOVER_ATTEMPTS
            ) {
              diagnosticsService.record({
                category: "playback",
                level: "warn",
                message:
                  "Auto-recover already attempted for this episode; opening post-play instead of looping",
                context: {
                  provider: resolvedProviderId,
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  endReason: result.endReason,
                  watchedSeconds: result.watchedSeconds,
                },
              });
              if (shouldReleasePersistentMpvBeforePostPlay(result, true)) {
                const failureClass = classifyPlaybackFailureFromResult(result);
                const playerProblem = buildPlayerFailureProblem(failureClass);
                await releasePersistentMpvForTerminalFailure({
                  player,
                  playerControl,
                  userMessage: playerProblem.userMessage,
                  reason: `playback-auto-recover-exhausted:${failureClass}`,
                  diagnostics: diagnosticsService,
                });
              }
              this.updatePlaybackFeedback(context, {
                detail: "Could not start playback",
                note: "Press o for sources, f for fallback, r to retry, or /diagnostics for details",
              });
              skipRefreshContinue = true;
            } else if (isAutoSourceRecover) {
              if (currentSourceId && !run.triedFailoverSourceIds.includes(currentSourceId)) {
                run.triedFailoverSourceIds.push(currentSourceId);
              }

              const failoverPlan = planStartupFailover({
                sourceIds: listOrderedPlaybackSourceIds(preparedStream.providerResolveResult),
                currentSourceId,
                triedSourceIds: new Set(run.triedFailoverSourceIds),
                hasFallbackProvider: Boolean(
                  pickCompatibleFallbackProvider(
                    providerRegistry.getCompatible(title, stateManager.getState().mode),
                    resolvedProviderId,
                  ),
                ),
                failoverAttempts: run.autoSourceRecoverAttempts,
                maxFailoverAttempts: MAX_AUTO_SOURCE_RECOVER_ATTEMPTS,
                providerHopUsed: run.startupProviderHopUsed,
              });

              if (failoverPlan.kind === "advance-source") {
                await selectionCoordinator.applyManualSourcePick(
                  resolvedProviderId,
                  currentEpisode,
                  failoverPlan.sourceId,
                );
                diagnosticsService.record({
                  category: "playback",
                  message: "Startup stall failover advancing to next catalog source",
                  context: {
                    operation: "playback.startup-stall.failover",
                    fromSourceId: currentSourceId,
                    toSourceId: failoverPlan.sourceId,
                    provider: resolvedProviderId,
                    titleId: title.id,
                    season: currentEpisode.season,
                    episode: currentEpisode.episode,
                  },
                });
              } else if (failoverPlan.kind === "fallback-provider") {
                shouldAutoFallbackProvider = true;
                skipRefreshContinue = true;
              } else {
                diagnosticsService.record({
                  category: "playback",
                  level: "warn",
                  message: "Startup failover exhausted catalog sources and provider hops",
                  context: {
                    provider: resolvedProviderId,
                    titleId: title.id,
                    season: currentEpisode.season,
                    episode: currentEpisode.episode,
                    triedSourceIds: run.triedFailoverSourceIds,
                  },
                });
                if (shouldReleasePersistentMpvBeforePostPlay(result, true)) {
                  const failureClass = classifyPlaybackFailureFromResult(result);
                  const playerProblem = buildPlayerFailureProblem(failureClass);
                  await releasePersistentMpvForTerminalFailure({
                    player,
                    playerControl,
                    userMessage: playerProblem.userMessage,
                    reason: `playback-startup-failover-exhausted:${failureClass}`,
                    diagnostics: diagnosticsService,
                  });
                }
                this.updatePlaybackFeedback(context, {
                  detail: "Could not start playback",
                  note: "Press o for sources, f for fallback, r to retry, or /diagnostics for details",
                });
                skipRefreshContinue = true;
              }
            }

            if (!skipRefreshContinue) {
              run.pendingRecomputeSources = playbackControlAction === "recompute";
              run.pendingStart = startAtResumePoint(
                toHistoryTimestamp(result, effectiveTiming.current, quitThresholdMode),
                { suppressResumePrompt: true },
              );
              run.pendingSourceRefreshAction =
                playbackControlAction === "recompute"
                  ? "recover"
                  : result.suspectedDeadStream === true ||
                      didPlaybackFailToStart(result) ||
                      playbackControlAction === "recover"
                    ? "recover"
                    : "refresh";
              if (isAutoSourceRecover) {
                run.autoSourceRecoverAttempts += 1;
              }
              diagnosticsService.record(
                buildRecoveryDiagnosticEvent({
                  operation: "playback.source-refresh.requested",
                  stage: run.pendingSourceRefreshAction,
                  status: "started",
                  severity: isAutoSourceRecover ? "recoverable" : "degraded",
                  recommendedAction:
                    run.pendingSourceRefreshAction === "recover" ? "recover" : "refresh-source",
                  message:
                    run.pendingSourceRefreshAction === "recover"
                      ? "Recovery requested for current provider source"
                      : "Refresh requested for current provider source",
                  providerId: resolvedProviderId,
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  context: {
                    provider: resolvedProviderId,
                    titleId: title.id,
                    season: currentEpisode.season,
                    episode: currentEpisode.episode,
                    resumeSeconds: run.pendingStart.startAt,
                    action: run.pendingSourceRefreshAction,
                    recomputeSources: run.pendingRecomputeSources,
                    autoRecover: isAutoSourceRecover,
                    autoRecoverAttempts: run.autoSourceRecoverAttempts,
                  },
                }),
              );
              run.playbackSession = this.transitionPlaybackSession(
                context,
                run.playbackSession,
                "recovery-started",
                {
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  provider: resolvedProviderId,
                  action: run.pendingSourceRefreshAction,
                },
              );
              continue;
            }
          }

          if (shouldAutoFallbackProvider) {
            run.pendingStart = startEpisodeNavigation({
              targetResumeSeconds: toHistoryTimestamp(
                result,
                effectiveTiming.current,
                quitThresholdMode,
              ),
            });
            const fallback = pickCompatibleFallbackProvider(
              providerRegistry.getCompatible(title, stateManager.getState().mode),
              resolvedProviderId,
            );

            if (fallback) {
              run.sessionSoftProviderId = null;
              const switched = await switchPlaybackProviderFallback({
                container,
                fromProviderId: resolvedProviderId,
                toProviderId: fallback.metadata.id,
                title,
                episode: currentEpisode,
                mode: stateManager.getState().mode,
                invalidateRecentEpisodeStream,
              });
              resolvedProviderId = switched.providerId;
              run.pendingSourceRefreshAction = "recover";
              run.pendingRecomputeSources = false;
              run.startupProviderHopUsed = true;
              run.triedFailoverSourceIds = [];
              if (playbackControlAction !== "fallback") {
                run.autoSourceRecoverAttempts += 1;
              }
              diagnosticsService.record(
                buildRecoveryDiagnosticEvent({
                  operation:
                    playbackControlAction === "fallback"
                      ? "playback.provider-fallback.started"
                      : "playback.startup-stall.failover",
                  stage: "fallback-provider",
                  status: "started",
                  severity: "recoverable",
                  recommendedAction: "fallback-provider",
                  message:
                    playbackControlAction === "fallback"
                      ? "Switching to fallback provider after playback control request"
                      : "Startup stall failover hopping to next compatible provider",
                  providerId: switched.providerId,
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  context: {
                    from: switched.fromProviderId,
                    fallback: switched.providerId,
                    titleId: title.id,
                    season: currentEpisode.season,
                    episode: currentEpisode.episode,
                    resumeSeconds: run.pendingStart.resumePromptAt,
                    autoFailover: playbackControlAction !== "fallback",
                  },
                }),
              );
              continue;
            }

            diagnosticsService.record(
              buildRecoveryDiagnosticEvent({
                operation: "playback.provider-fallback.unavailable",
                stage: "fallback-provider",
                status: "failed",
                severity: "blocked",
                failureClass: "not-found",
                message:
                  "Fallback playback control requested but no compatible provider was available",
                providerId: resolvedProviderId,
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
                context: {
                  provider: resolvedProviderId,
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                },
              }),
            );
            // Keep the pending start intent for this episode; re-resolve instead of falling
            // through to auto-advance / post-playback with a poisoned resume offset.
            continue;
          }

          if (playbackControlAction === "back-to-search") {
            return { status: "success", value: "back_to_search" };
          }

          if (playbackControlAction === "next" && title.type === "series") {
            if (episodeAvailability.nextEpisode) {
              run.pendingStart = await navigatePlaybackEpisode(episodeAvailability.nextEpisode, {
                loadingOrder: "before-start",
                resetStopAfterCurrent: true,
                resumeInterruptedAutoplay: true,
              });
              const prefetchTarget = buildNextPrefetchTarget();
              if (prefetchTarget) {
                await handoffNextEpisodePrefetch(prefetchTarget, "playback.prefetch-wait");
              }
              continue;
            }
          }

          if (playbackControlAction === "previous" && title.type === "series") {
            if (episodeAvailability.previousEpisode) {
              run.pendingStart = await navigatePlaybackEpisode(
                episodeAvailability.previousEpisode,
                {
                  cancelPrefetchReason: "user-navigation",
                  loadingOrder: "after-start",
                  resetStopAfterCurrent: true,
                  resumeInterruptedAutoplay: true,
                },
              );
              continue;
            }
          }

          if (playbackControlAction === "pick-episode" && confirmedEpisodeSelection) {
            run.pendingStart = await navigatePlaybackEpisode(confirmedEpisodeSelection, {
              cancelPrefetchReason: "user-navigation",
              loadingOrder: "after-start",
              resetStopAfterCurrent: true,
              resumeInterruptedAutoplay: true,
            });
            continue;
          }

          if (playbackControlAction === "pick-source") {
            if (confirmedStreamSelection) {
              run.pendingStart = await applyConfirmedPlaybackTrackSelection(
                playbackControlAction,
                confirmedStreamSelection,
                toHistoryTimestamp(
                  result,
                  effectiveTiming.current,
                  config.quitNearEndThresholdMode,
                ),
              );
              continue;
            }
            const picked = await openTracksPanel(
              preparedStream,
              { initialSection: "source" },
              container,
            );
            const selection = picked ? streamSelectionFromTrackPick(picked) : null;
            if (picked && selection) {
              const restartResume = toHistoryTimestamp(
                result,
                effectiveTiming.current,
                config.quitNearEndThresholdMode,
              );
              run.pendingStart = await completeSourceTrackPick(
                currentEpisode,
                picked,
                selection,
                restartResume,
                "playback-control-track-override",
              );
              recordTrackOverrideSelected(picked, selection);
              continue;
            }
          }

          if (playbackControlAction === "pick-stream") {
            if (confirmedStreamSelection) {
              run.pendingStart = await applyConfirmedPlaybackTrackSelection(
                playbackControlAction,
                confirmedStreamSelection,
                toHistoryTimestamp(
                  result,
                  effectiveTiming.current,
                  config.quitNearEndThresholdMode,
                ),
              );
              continue;
            }
            const picked = await openTracksPanel(preparedStream, {}, container);
            const selection = picked ? streamSelectionFromTrackPick(picked) : null;
            if (picked && selection) {
              const restartResume = toHistoryTimestamp(
                result,
                effectiveTiming.current,
                config.quitNearEndThresholdMode,
              );
              run.pendingStart = await completeSourceTrackPick(
                currentEpisode,
                picked,
                selection,
                restartResume,
                "playback-control-track-override",
              );
              recordTrackOverrideSelected(picked, selection);
              continue;
            }
          }

          if (playbackControlAction === "pick-quality") {
            if (confirmedStreamSelection) {
              run.pendingStart = await applyConfirmedPlaybackTrackSelection(
                playbackControlAction,
                confirmedStreamSelection,
                toHistoryTimestamp(
                  result,
                  effectiveTiming.current,
                  config.quitNearEndThresholdMode,
                ),
              );
              continue;
            }
            const picked = await openTracksPanel(
              preparedStream,
              { initialSection: "quality" },
              container,
            );
            const selection = picked ? streamSelectionFromTrackPick(picked) : null;
            if (picked && selection) {
              const restartResume = toHistoryTimestamp(
                result,
                effectiveTiming.current,
                config.quitNearEndThresholdMode,
              );
              run.pendingStart = await completeSourceTrackPick(
                currentEpisode,
                picked,
                selection,
                restartResume,
                "playback-control-track-override",
              );
              recordTrackOverrideSelected(picked, selection);
              continue;
            }
          }

          // Handle post-playback
          diagnosticsService.record({
            category: "playback",
            message: "Evaluating autoplay advance",
            context: {
              endReason: result.endReason,
              watchedSeconds: result.watchedSeconds,
              duration: result.duration,
              lastNonZeroPos: result.lastNonZeroPositionSeconds,
              lastNonZeroDur: result.lastNonZeroDurationSeconds,
              sessionMode: run.playbackSession.mode,
              autoplayPaused: run.playbackSession.autoplayPaused,
              stopAfterCurrent: run.playbackSession.stopAfterCurrent,
              hasNextEpisode: Boolean(episodeAvailability.nextEpisode),
              upcomingNext: episodeAvailability.upcomingNext,
              animeNextReleaseUnknown: episodeAvailability.animeNextReleaseUnknown,
            },
          });
          const autoplayAdvanceArgs = {
            result,
            title,
            currentEpisode,
            session: run.playbackSession,
            availability: episodeAvailability,
            timing: effectiveTiming.current,
            endPolicy: {
              quitNearEndBehavior: config.quitNearEndBehavior,
              quitNearEndThresholdMode: config.quitNearEndThresholdMode,
            },
          };
          const readAutoAdvanceGuards = (): AutoAdvanceGuards => ({
            endReason: result.endReason,
            autoplayPaused: run.playbackSession.autoplayPaused,
            autoplaySessionPaused: stateManager.getState().autoplaySessionPaused,
            signalAborted: context.signal.aborted,
          });
          const { nextEpisode, catalogAutoNext, catalogAutoplayEndBanner, blockedBy } =
            await planCatalogAutoAdvance({
              autoplayAdvanceArgs,
              guards: readAutoAdvanceGuards(),
              seriesDone: !episodeAvailability.nextEpisode,
              autoplayRecommendations: container.config.autoplayRecommendations,
              isAnime: stateManager.getState().mode === "anime",
              anilistTitleId: title.id,
              catalogScheduleService: container.catalogScheduleService,
            });
          if (blockedBy) {
            diagnosticsService.record({
              category: "playback",
              message: "Auto-next blocked",
              context: {
                blockedBy,
                endReason: result.endReason,
                watchedSeconds: result.watchedSeconds,
                duration: result.duration,
                autoplayMode: run.playbackSession.mode,
                autoplayPaused: run.playbackSession.autoplayPaused,
                stopAfterCurrent: run.playbackSession.stopAfterCurrent,
                hasNextEpisode: Boolean(episodeAvailability.nextEpisode),
                upcomingNext: episodeAvailability.upcomingNext,
                animeNextReleaseUnknown: episodeAvailability.animeNextReleaseUnknown,
                catalogBanner: catalogAutoplayEndBanner ?? null,
              },
            });
          }
          if (catalogAutoNext?.kind === "episode") {
            const nextEpisodeAdvance = catalogAutoNext.episode;
            const countdownResult = await this.runAutoNextCountdown(context, nextEpisodeAdvance);
            if (countdownResult === "cancelled") {
              // Stop/back/previous cancels this advance only; the session
              // autoplay preference reflects what the user set with `a`.
              const autoplayPaused = stateManager.getState().autoplaySessionPaused;
              run.playbackSession = {
                ...run.playbackSession,
                autoplayPaused,
                autoplayPauseReason: autoplayPaused ? "user" : null,
              };
              diagnosticsService.record({
                category: "playback",
                message: "Auto-next countdown cancelled",
                context: {
                  titleId: title.id,
                  nextSeason: nextEpisodeAdvance.season,
                  nextEpisode: nextEpisodeAdvance.episode,
                },
              });
              this.updatePlaybackFeedback(context, {
                detail: "Auto-next paused",
                note: "Press resume when you want to continue.",
              });
            } else {
              logger.info("Auto-next advancing to next episode", {
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
                nextSeason: nextEpisodeAdvance.season,
                nextEpisode: nextEpisodeAdvance.episode,
                hasPrefetch: episodePrefetch.hasReadyFor(
                  buildPrefetchTarget(nextEpisodeAdvance, resolvedProviderId),
                ),
              });
              diagnosticsService.record({
                category: "playback",
                message: "Auto-next advancing to next episode",
                context: {
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  nextSeason: nextEpisodeAdvance.season,
                  nextEpisode: nextEpisodeAdvance.episode,
                  hasPrefetch: episodePrefetch.hasReadyFor(
                    buildPrefetchTarget(nextEpisodeAdvance, resolvedProviderId),
                  ),
                },
              });

              this.updatePlaybackFeedback(context, {
                detail: "Loading next episode",
                note: `S${String(nextEpisodeAdvance.season).padStart(2, "0")}E${String(nextEpisodeAdvance.episode).padStart(2, "0")}`,
              });

              run.pendingStart = await navigatePlaybackEpisode(nextEpisodeAdvance, {
                loadingOrder: "before-start",
                resetStopAfterCurrent: true,
              });

              const autoplayPrefetchTarget = buildPrefetchTarget(
                nextEpisodeAdvance,
                resolvedProviderId,
              );
              await handoffNextEpisodePrefetch(
                autoplayPrefetchTarget,
                "post-playback.autonext.prefetch-wait",
              );

              continue;
            }
          }

          const stopAfterCurrentAtMenuEntry = run.playbackSession.stopAfterCurrent;
          if (run.playbackSession.stopAfterCurrent) {
            stateManager.dispatch({ type: "SET_SESSION_STOP_AFTER_CURRENT", enabled: false });
            run.playbackSession = {
              ...run.playbackSession,
              stopAfterCurrent: false,
            };
          }

          await player.releasePersistentSession();
          this.clearPresenceInBackground(context, "presence.clearPlaybackIdle", "playback-idle");
          preparePostPlaybackSurface(container, episodePrefetch, playbackIterationAbort);
          this.updatePlaybackFeedback(context, { detail: null, note: null });
          run.playbackSession = this.transitionPlaybackSession(
            context,
            run.playbackSession,
            "post-playback-opened",
            {
              titleId: title.id,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
              endReason: result.endReason,
            },
          );

          const recommendationRail = new PostPlaybackRecommendationRail({
            container,
            title,
            budgetMs: stateManager.getState().mode === "youtube" ? 2_500 : 250,
          });
          const autoContinueIntoRecommendationPossible = canAutoContinueIntoRecommendation({
            sessionMode: run.playbackSession.mode,
            hasNextEpisode: Boolean(episodeAvailability.nextEpisode),
            endReason: result.endReason,
            autoplayPaused: run.playbackSession.autoplayPaused,
            autoplaySessionPaused: stateManager.getState().autoplaySessionPaused,
            aborted: context.signal.aborted,
            hasQueuedNext: Boolean(container.queueService.peekNext()),
            autoplayRecommendationsEnabled: container.config.autoplayRecommendations,
          });
          const recommendationRailItems = await recommendationRail.resolveRailItems({
            mode: stateManager.getState().mode,
            prefetchedItems: prefetchedRecommendationItems,
            autoContinueIntoRecommendationPossible,
          });
          const topRec = recommendationRailItems[0];
          const topRecommendation = topRec
            ? {
                mediaKind: topRec.type === "movie" ? "movie" : "series",
                titleId: topRec.id,
                title: topRec.title,
                sourceId: topRec.sourceId,
              }
            : null;

          const playlistAutoNext = planPlaylistAutoAdvance({
            catalogNextEpisode: nextEpisode,
            guards: readAutoAdvanceGuards(),
            queueHead: container.queueService.peekNext(),
            seriesHasNextEpisode: Boolean(episodeAvailability.nextEpisode),
            autoplayRecommendations: container.config.autoplayRecommendations,
            topRecommendation,
          });
          if (playlistAutoNext?.kind === "queue") {
            const nextPlaylistItem = playlistAutoNext.entry;
            const selectedQueueId = nextPlaylistItem.id;
            const autoNextIntent = container.queueService.beginPlayback(
              selectedQueueId,
              "auto-next",
            );
            if (autoNextIntent) {
              const nextPlaylistLabel =
                formatQueueEntryLabel(nextPlaylistItem) ?? nextPlaylistItem.title;
              const playlistCountdown = await runAutoplayAdvanceCountdown({
                seconds: 3,
                signal: context.signal,
                sleep: (ms) => Bun.sleep(ms),
                onTick: (remaining) => {
                  this.updatePlaybackFeedback(context, {
                    detail: "Playlist next ready",
                    note: `Next: ${nextPlaylistLabel} in ${remaining}s  ·  a to pause`,
                  });
                },
                isCancelled: () => stateManager.getState().autoplaySessionPaused,
              });
              const autoNextDecision = resolvePlaylistAutoNextCountdown({
                intent: autoNextIntent,
                title: nextPlaylistItem.title,
                season: nextPlaylistItem.season,
                episode: nextPlaylistItem.episode,
                countdown: playlistCountdown === "cancelled" ? "cancelled" : "advanced",
              });
              if (autoNextDecision.kind === "advance") {
                return {
                  status: "success",
                  value: autoNextDecision.outcome,
                };
              }
              container.queueService.rollbackBeforeStart(
                autoNextDecision.intent,
                autoNextDecision.failure,
              );
            }
            {
              const autoplayPaused = stateManager.getState().autoplaySessionPaused;
              run.playbackSession = {
                ...run.playbackSession,
                autoplayPaused,
                autoplayPauseReason: autoplayPaused ? "user" : null,
              };
            }
            this.updatePlaybackFeedback(context, { detail: null, note: null });
          } else if (
            playlistAutoNext?.kind === "recommendation" &&
            canAdvanceIntoRecommendation({
              shellMode: stateManager.getState().mode,
              recommendationId: playlistAutoNext.item.titleId,
            })
          ) {
            const topRecAdvance = playlistAutoNext.item;
            const recCountdown = await runAutoplayAdvanceCountdown({
              seconds: 5,
              signal: context.signal,
              sleep: (ms) => Bun.sleep(ms),
              onTick: (remaining) => {
                this.updatePlaybackFeedback(context, {
                  detail: "Up next ready",
                  note: `Up next: ${topRecAdvance.title} in ${remaining}s  ·  a to pause`,
                });
              },
              isCancelled: () => stateManager.getState().autoplaySessionPaused,
            });
            if (recCountdown !== "cancelled") {
              return {
                status: "success",
                value: {
                  type: "playlist-advance",
                  titleInfo: {
                    id: topRecAdvance.titleId,
                    name: topRecAdvance.title,
                    type: topRec?.type === "movie" ? "movie" : "series",
                    posterUrl: topRec?.posterPath ?? undefined,
                    ...(topRec?.externalIds ? { externalIds: topRec.externalIds } : {}),
                  },
                  mode: stateManager.getState().mode,
                },
              };
            }
            {
              const autoplayPaused = stateManager.getState().autoplaySessionPaused;
              run.playbackSession = {
                ...run.playbackSession,
                autoplayPaused,
                autoplayPauseReason: autoplayPaused ? "user" : null,
              };
            }
            this.updatePlaybackFeedback(context, { detail: null, note: null });
          }

          // Post-playback menu — inner loop so unavailable navigation
          // actions stay in the menu instead of re-resolving the stream.
          const { openPlaybackShell } = await import("../../app-shell/ink-shell");

          const iteration = createPlaybackIteration({
            title,
            currentEpisode,
            episodeAvailability,
            result,
            effectiveTimingCurrent: effectiveTiming.current,
            nextEpisode,
            catalogAutoplayEndBanner,
            shellEpisodePicker,
            watchedEntries,
            prefetchedRecommendationItems,
            currentAnimeEpisodes,
            preparedStream,
            resolvedProviderId,
            openRecoverySourcePanelOnPostPlay:
              (result.suspectedDeadStream === true &&
                Boolean(preparedStream.providerResolveResult?.streams.length)) ||
              didPlaybackFailToStart(result),
            stopAfterCurrentAtMenuEntry,
          });

          const postPlaybackMenuDeps = createPostPlaybackMenuDeps({
            container,
            signal: context.signal,
            quitNearEndBehavior: config.quitNearEndBehavior,
            quitNearEndThresholdMode: config.quitNearEndThresholdMode,
            recommendationRail,
            historyRepository,
            diagnosticsService,
            getMode: () => stateManager.getState().mode,
            getAutoplaySessionPaused: () => stateManager.getState().autoplaySessionPaused,
            getAutoskipSessionPaused: () => stateManager.getState().autoskipSessionPaused,
            getProvider: () => stateManager.getState().provider,
            getAnimeSubtitlePreference: () => stateManager.getState().animeLanguageProfile.subtitle,
            getSeriesSubtitlePreference: () =>
              stateManager.getState().seriesLanguageProfile.subtitle,
            dispatchAutoplayPaused: (paused) =>
              stateManager.dispatch({ type: "SET_SESSION_AUTOPLAY_PAUSED", paused }),
            dispatchAutoskipPaused: (paused) =>
              stateManager.dispatch({ type: "SET_SESSION_AUTOSKIP_PAUSED", paused }),
            dispatchStopAfterCurrent: (enabled) =>
              stateManager.dispatch({ type: "SET_SESSION_STOP_AFTER_CURRENT", enabled }),
            dispatchWatchTimeSummary: (summary) =>
              stateManager.dispatch({ type: "SET_WATCH_TIME_SUMMARY", summary }),
            updatePlaybackFeedback: (feedback) => this.updatePlaybackFeedback(context, feedback),
            transitionPlaybackSession: (session, event, meta) =>
              this.transitionPlaybackSession(context, session, event, meta ?? {}),
            runAutoNextCountdown: (nextEpisodeTarget) =>
              this.runAutoNextCountdown(context, nextEpisodeTarget),
            navigatePlaybackEpisode,
            completeSourceTrackPick,
            handoffNextEpisodePrefetch,
            buildPrefetchTarget,
            invalidateRecentEpisodeStream,
            openPlaybackShell,
            chooseEpisodeFromMetadata: async (input) => {
              const { chooseEpisodeFromMetadata } = await import("@/session-flow");
              return chooseEpisodeFromMetadata(input);
            },
            episodeInfoFromSelection,
            readAutoAdvanceGuards,
            getCompatibleProviders: () =>
              providerRegistry.getCompatible(title, stateManager.getState().mode),
            teardownPlaybackForPostPlayExit: () =>
              teardownPlaybackForPostPlayExit(container, episodePrefetch, playbackIterationAbort),
          });

          const postPlaybackResult = await runPostPlaybackMenuAfterEpisode({
            run,
            iteration,
            deps: postPlaybackMenuDeps,
          });
          resolvedProviderId = iteration.resolvedProviderId;
          if (postPlaybackResult.kind === "exit") {
            return postPlaybackResult.result;
          }
          if (postPlaybackResult.kind === "playlist-advance") {
            return { status: "success", value: postPlaybackResult.value };
          }
        } catch (e) {
          if (resolveController.signal.aborted && !context.signal.aborted) {
            stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
            stateManager.dispatch({ type: "SET_STREAM", stream: null });
            this.updatePlaybackFeedback(context, { detail: null, note: null });
            diagnosticsService.record({
              category: "playback",
              message: "Playback resolve cancelled",
              context: {
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
              },
            });
            return { status: "success", value: "back_to_results" };
          }
          throw e;
        } finally {
          workControl.setActive(null);
          context.signal.removeEventListener("abort", abortOnSessionStop);
        }
      }
    } catch (e) {
      if (context.signal.aborted) {
        this.releasePlaybackLedgerWithoutPersist();
        this.updatePlaybackFeedback(context, { detail: null, note: null });
        return { status: "cancelled" };
      }
      logger.error("Playback phase error", { error: String(e) });
      return {
        status: "error",
        error: kitsuneErrorFromUnknown(e, {
          code: "PLAYER_FAILED",
          message: "Playback failed",
          retryable: false,
        }),
      };
    } finally {
      queueAttempt?.rollbackIfUnacknowledged("playback-aborted");
      this.updatePlaybackFeedback(context, { detail: null, note: null });
      await player.releasePersistentSession();
    }

    // Fallback return (should not reach here)
    return { status: "success", value: "back_to_search" };
  }

  private retryTimingInBackground(
    title: TitleInfo,
    episode: EpisodeInfo,
    container: PhaseContext["container"],
    timingRef?: { current: PlaybackTimingMetadata | null },
    cache?: Map<string, PlaybackTimingMetadata | null>,
    isAnime?: boolean,
    providerIdOverride?: string,
  ): Promise<void> {
    return (async () => {
      const mode = isAnime ? "anime" : title.type === "movie" ? "movie" : "series";
      const providerId = providerIdOverride ?? container.stateManager.getState().provider;
      const timing = await timingAggregator.resolve(
        title,
        episode,
        mode,
        AbortSignal.timeout(10_000),
        {
          providerId,
          onSourceOutcome: (outcome) =>
            recordTimingSourceDiagnostic(container.diagnosticsService, {
              outcome,
              titleId: title.id,
              season: episode.season,
              episode: episode.episode,
              providerId,
            }),
        },
      );
      if (timing) {
        if (timingRef) timingRef.current = timing;
        if (cache) {
          cache.set(playbackTimingCacheKey(title, episode, providerId), timing);
        }
        container.playerControl.updateCurrentPlaybackTiming(timing, "background-retry");
      }
    })();
  }

  private async getPlaybackTimingMetadata(
    title: TitleInfo,
    episode: EpisodeInfo,
    cache: Map<string, PlaybackTimingMetadata | null>,
    signal?: AbortSignal,
    isAnime?: boolean,
    providerId?: string,
    diagnostics?: PhaseContext["container"]["diagnosticsService"],
  ) {
    const cacheKey = playbackTimingCacheKey(title, episode, providerId);

    if (cache.has(cacheKey)) {
      return cache.get(cacheKey) ?? null;
    }

    const mode = isAnime ? "anime" : title.type === "movie" ? "movie" : "series";
    const timing = await timingAggregator.resolve(title, episode, mode, signal, {
      providerId,
      onSourceOutcome: diagnostics
        ? (outcome) =>
            recordTimingSourceDiagnostic(diagnostics, {
              outcome,
              titleId: title.id,
              season: episode.season,
              episode: episode.episode,
              providerId,
            })
        : undefined,
    });
    cache.set(cacheKey, timing);
    return timing;
  }

  private async resolveEpisodePrefetchBundle(
    context: PhaseContext,
    input: {
      readonly title: TitleInfo;
      readonly nextEpisode: EpisodeInfo;
      readonly providerId: string;
      readonly target?: EpisodePrefetchTarget;
      readonly onProgress?: (progress: EpisodePrefetchProgress) => void;
      readonly signal: AbortSignal;
    },
  ): Promise<EpisodePrefetchBundle | null> {
    const { config, stateManager, playbackResolveWork } = context.container;
    const mode = stateManager.getState().mode;
    const profileCtx = { mode, title: input.title, config: config.getRaw() };
    const subLang = playbackSubtitlePreference(profileCtx);
    const isInteractiveSubtitle = subLang === "interactive" || subLang === "fzf";

    const stream = await playbackResolveWork.prefetch(
      {
        title: input.title,
        episode: input.nextEpisode,
        mode,
        providerId: input.providerId,
        audioPreference: playbackAudioPreference(profileCtx),
        subtitlePreference: playbackSubtitlePreference(profileCtx),
        qualityPreference: playbackQualityPreference(profileCtx),
        startupPriority: config.startupPriority,
        selectedSourceId: input.target?.sourceId,
        selectedStreamId: input.target?.streamId,
        recoveryMode: config.recoveryMode,
        signal: input.signal,
        onEvent: (event) => {
          if (event.type === "cache-hit" || event.type === "cache-hit-validated") {
            input.onProgress?.({ exactStreamCacheHit: true });
          } else if (event.type === "source-inventory-hit") {
            input.onProgress?.({ sourceInventoryHit: true, streamValidationActive: true });
          } else if (event.type === "provider-resolve-started") {
            input.onProgress?.({ providerResolveActive: true });
          } else if (event.type === "attempt" && event.attempt > 1) {
            input.onProgress?.({ fallbackAttemptStarted: true });
          }
        },
      },
      { intentKind: "prefetch", budgetLane: "near-need" },
    );

    if (!stream) return null;
    input.onProgress?.({ videoReady: true, candidateStreamsReturned: true });

    const target: EpisodePrefetchTarget = input.target ?? {
      titleId: input.title.id,
      episode: input.nextEpisode,
      providerId: input.providerId,
      audioPreference: playbackAudioPreference(profileCtx),
      qualityPreference: playbackQualityPreference(profileCtx),
      startupPriority: config.startupPriority,
      subtitlePreference: playbackSubtitlePreference(profileCtx),
    };
    const resolvedProviderId = stream.providerId;

    if (isInteractiveSubtitle) {
      return { target, stream: stream.stream, prepared: false, resolvedProviderId };
    }

    const preparedStream = await this.preparePlaybackStream(
      stream.stream,
      input.title,
      input.nextEpisode,
      context,
    );

    return { target, stream: preparedStream, prepared: true, resolvedProviderId };
  }

  private async preparePlaybackStream(
    stream: StreamInfo,
    title: TitleInfo,
    episode: EpisodeInfo,
    context: PhaseContext,
  ): Promise<StreamInfo> {
    const { stateManager, logger, config } = context.container;
    const subLang = playbackSubtitlePreference({
      mode: stateManager.getState().mode,
      title,
      config,
    });

    if (shouldSkipExternalSubtitleLookup(stream, subLang)) {
      logger.info("Subtitle resolution skipped", {
        provider: stateManager.getState().provider,
        titleId: title.id,
        requestedSubLang: subLang,
        reason: "hardsub-satisfied-or-disabled",
      });
      return stream;
    }

    const subtitleDecision = await choosePlaybackSubtitle({
      stream,
      subLang,
      pickSubtitle: (tracks) =>
        openSubtitlePicker(
          tracks,
          buildPickerActionContext({
            container: context.container,
            taskLabel: "Choose subtitles",
          }),
          context.container,
        ),
    });

    logger.info("Subtitle resolution", {
      provider: stateManager.getState().provider,
      titleId: title.id,
      type: title.type,
      season: episode.season,
      episode: episode.episode,
      requestedSubLang: subLang,
      subtitleReason: subtitleDecision.reason,
      availableTracks: subtitleDecision.availableTracks,
      subtitleSelected: subtitleDecision.subtitle ?? null,
      providerSubtitleSource: stream.subtitleSource ?? "none",
      providerSubtitleEvidence: stream.subtitleEvidence ?? null,
    });
    context.container.diagnosticsService.record({
      category: "subtitle",
      message: "Subtitle resolution",
      context: {
        provider: stateManager.getState().provider,
        titleId: title.id,
        type: title.type,
        season: episode.season,
        episode: episode.episode,
        requestedSubLang: subLang,
        subtitleReason: subtitleDecision.reason,
        availableTracks: subtitleDecision.availableTracks,
        subtitleSelected: subtitleDecision.subtitle ?? null,
        providerSubtitleSource: stream.subtitleSource ?? "none",
        providerSubtitleEvidence: stream.subtitleEvidence ?? null,
      },
    });

    return {
      ...stream,
      subtitle: subtitleDecision.subtitle ?? undefined,
    };
  }

  /**
   * Rejected / aborted / skipped-history sessions must not survive coordinated
   * shutdown flush. Clears ledger state and unregisters only this phase's
   * active checkpoint (registration-scoped — never `clear()`, which would wipe
   * a newer playback's callback).
   */
  private releasePlaybackLedgerWithoutPersist(): void {
    this.playbackLedger?.discard();
    this.playbackLedger = null;
    this.unregisterActiveCheckpoint?.();
    this.unregisterActiveCheckpoint = null;
  }

  private async playStream(
    stream: StreamInfo,
    title: TitleInfo,
    episode: EpisodeInfo,
    context: PhaseContext,
    startAt = 0,
    resumePromptAt = 0,
    playbackMode: "manual" | "autoplay-chain" = "manual",
    timing: PlaybackTimingMetadata | null = null,
    onNearEof?: () => void,
    suppressResumePrompt = false,
    correlation?: DiagnosticCorrelation,
    onStartupMark?: (stage: PlaybackStartupStage) => void,
    successfulProviderId?: string,
    playbackIterationSignal?: AbortSignal,
    onConfirmedPlaybackStart?: () => void,
  ): Promise<PlaybackResult> {
    const {
      player,
      stateManager,
      config,
      historyRepository,
      playbackEventRepository,
      playerControl,
      diagnosticsService,
    } = context.container;

    const subtitleStatus = describePlaybackSubtitleStatus(
      stream,
      playbackSubtitlePreference({
        mode: stateManager.getState().mode,
        title,
        config,
      }),
    );

    this.startLateSubtitleResolver({
      stream,
      title,
      episode,
      context,
      playbackIterationSignal,
    });

    const playbackProviderId = successfulProviderId ?? stateManager.getState().provider;
    const presenceBase = () => ({
      mode: stateManager.getState().mode,
      title,
      episode,
      providerId: playbackProviderId,
      stream,
      startedAtMs: Date.now(),
    });

    const ledgerProviderId = playbackProviderId;
    const persistedKind = classifyPersistedKind(title, stateManager.getState().mode, {
      providerId: ledgerProviderId,
    });
    this.playbackLedger = new PlaybackHistoryLedger(historyRepository, playbackEventRepository);
    // Shutdown flushes this before releasing mpv, so the latest resume
    // position survives a Ctrl+C mid-playback. Null-safe once finalized.
    this.unregisterActiveCheckpoint = context.container.activePlaybackCheckpoint.register(() => {
      this.playbackLedger?.checkpoint();
    });
    this.playbackLedger.start(
      {
        title: {
          id: title.id,
          kind: persistedKind,
          title: title.name,
          externalIds: enrichExternalIdsWithVideoMeta(
            title.externalIds,
            stateManager.getState().videoMeta,
          ),
        },
        episode:
          title.type === "series"
            ? { season: episode.season, episode: episode.episode }
            : undefined,
        providerId: ledgerProviderId,
        posterUrl: title.posterUrl,
        mediaKind: persistedKind,
      },
      startAt,
    );

    return runMpvPlaybackSession({
      stream,
      title,
      episode,
      player,
      subtitleStatus,
      startAt,
      sessionAborted: context.signal.aborted,
      iterationAborted: playbackIterationSignal?.aborted ?? false,
      correlation,
      timing,
      shareLinkContext: {
        mode: stateManager.getState().mode,
        title,
        episode:
          title.type === "series"
            ? { season: episode.season, episode: episode.episode }
            : undefined,
        providerId: playbackProviderId,
      },
      playOptions: {
        abortSignal: context.signal,
        audioPreference: playbackAudioPreference({
          mode: stateManager.getState().mode,
          title,
          config,
        }),
        subtitlePreference: playbackSubtitlePreference({
          mode: stateManager.getState().mode,
          title,
          config,
        }),
        qualityPreference: playbackQualityPreference({
          mode: stateManager.getState().mode,
          title,
          config,
        }),
        resumePromptAt,
        attach: false,
        playbackMode,
        resumeStartChoicePrompt: suppressResumePrompt ? false : config.resumeStartChoicePrompt,
        autoSkipEnabled: !stateManager.getState().autoskipSessionPaused,
        skipRecap: config.skipRecap,
        skipIntro: config.skipIntro,
        skipPreview: config.skipPreview,
        skipCredits: config.skipCredits,
        onNearEof,
      },
      hooks: {
        onFeedback: (update) => this.updatePlaybackFeedback(context, update),
        onStartupMark,
        onConfirmedPlaybackStart,
        onStartupStallAbort: () => {
          diagnosticsService.record(
            buildPlaybackDiagnosticEvent({
              operation: "playback.startup-stall.aborted",
              status: "failed",
              severity: "degraded",
              failureClass: "timeout",
              message: "Startup stall watchdog aborted mpv",
              correlation,
              context: {
                timeoutMs: STARTUP_STALL_TIMEOUT_MS,
                streamHost: (() => {
                  try {
                    return new URL(stream.url).hostname;
                  } catch {
                    return null;
                  }
                })(),
              },
            }),
          );
          const active = playerControl.getActive();
          if (!active) return;
          void active.stop("startup-stall").catch(() => {
            /* best-effort abort; suspectedDeadStream is set on return */
          });
        },
        onPresenceLaunch: ({ positionSeconds, subtitleCount }) => {
          this.updatePresenceInBackground(
            context,
            "presence.updatePlaybackLaunch",
            { ...presenceBase(), positionSeconds, subtitleCount },
            correlation,
          );
        },
        onPresenceStarted: ({ positionSeconds, durationSeconds }) => {
          this.updatePresenceInBackground(
            context,
            "presence.updatePlaybackStarted",
            {
              ...presenceBase(),
              positionSeconds,
              durationSeconds,
              subtitleCount: undefined,
            },
            correlation,
          );
        },
        onPresenceProgress: ({ positionSeconds, durationSeconds }) => {
          this.playbackLedger?.onProgress(positionSeconds, durationSeconds);
          this.updatePresenceInBackground(
            context,
            "presence.updatePlaybackProgress",
            { ...presenceBase(), positionSeconds, durationSeconds },
            correlation,
          );
        },
        onPresenceSubtitles: ({ positionSeconds, durationSeconds, trackCount }) => {
          this.updatePresenceInBackground(
            context,
            "presence.updatePlaybackSubtitles",
            {
              ...presenceBase(),
              positionSeconds,
              durationSeconds,
              subtitleCount: trackCount,
            },
            correlation,
          );
        },
        onPresencePaused: ({ positionSeconds, durationSeconds }) => {
          this.playbackLedger?.onPaused(positionSeconds, durationSeconds);
          this.updatePresenceInBackground(
            context,
            "presence.updatePlaybackPaused",
            {
              ...presenceBase(),
              positionSeconds,
              durationSeconds,
              paused: true,
            },
            correlation,
          );
        },
        onPresenceResumed: ({ positionSeconds, durationSeconds }) => {
          this.playbackLedger?.onResumed(positionSeconds, durationSeconds);
          this.updatePresenceInBackground(
            context,
            "presence.updatePlaybackResumed",
            { ...presenceBase(), positionSeconds, durationSeconds },
            correlation,
          );
        },
        setPlaybackStatus: (status) => {
          stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status });
        },
        getPlaybackStatus: () => stateManager.getState().playbackStatus,
        onTrackChanged: (event) => {
          const currentStream = stateManager.getState().stream;
          if (currentStream && event.trackType === "sub" && event.id === 0) {
            stateManager.dispatch({
              type: "SET_STREAM",
              stream: { ...currentStream, subtitle: undefined },
            });
          }
          context.container.diagnosticsService.record({
            category: "playback",
            message: "Track changed from mpv",
            context: {
              trackType: event.trackType,
              id: event.id,
            },
          });
        },
        onShareCopied: (shareCopy) => {
          this.updatePlaybackFeedback(context, {
            note: shareCopy?.copied
              ? "Share link copied from mpv."
              : shareCopy
                ? `Share link (copy manually): ${shareCopy.url}`
                : "Could not build a share link for this title.",
          });
        },
        onPlayerReady: () => {},
      },
    });
  }

  private startLateSubtitleResolver({
    stream,
    title,
    episode,
    context,
    playbackIterationSignal,
  }: {
    stream: StreamInfo;
    title: TitleInfo;
    episode: EpisodeInfo;
    context: PhaseContext;
    playbackIterationSignal?: AbortSignal;
  }): void {
    const iterationSignal = playbackIterationSignal ?? context.signal;
    const { stateManager, diagnosticsService, logger } = context.container;
    const mode = stateManager.getState().mode;
    const requestedSubLang = playbackSubtitlePreference({
      mode,
      title,
      config: context.container.config,
    });
    const provenTmdbId = resolveProvenNumericTmdbId(title, mode);
    const lookupDecision = shouldAttemptLateSubtitleLookup({
      stream,
      requestedSubLang,
      hasTmdbId: provenTmdbId !== null,
    });
    if (!lookupDecision.attempt) {
      if (
        lookupDecision.reason !== "disabled" &&
        lookupDecision.reason !== "attached" &&
        lookupDecision.reason !== "hardsub-satisfied"
      ) {
        diagnosticsService.record(
          buildSubtitleDiagnosticEvent({
            operation: "subtitle.lookup.skipped",
            status: "skipped",
            severity: "degraded",
            recommendedAction: "none",
            message:
              lookupDecision.reason === "tmdb-id-missing"
                ? "Late subtitle lookup skipped (TMDB identity missing)"
                : "Late subtitle lookup skipped",
            titleId: title.id,
            season: episode.season,
            episode: episode.episode,
            context: {
              requestedSubLang,
              reason: lookupDecision.reason,
              availableTracks: lookupDecision.availableTracks,
              // Redact: never report bare anime/AniList catalog ids as TMDB ids.
              ...(lookupDecision.reason === "tmdb-id-missing"
                ? { tmdbId: "<missing>" }
                : { titleId: title.id }),
            },
          }),
        );
      }
      return;
    }

    const tmdbId = provenTmdbId;
    if (!tmdbId) return;

    const inflightKey = `${title.id}:${episode.season}:${episode.episode}:${requestedSubLang}`;
    if (PlaybackPhase.lateSubtitleInflight.has(inflightKey)) {
      diagnosticsService.record(
        buildSubtitleDiagnosticEvent({
          operation: "subtitle.lookup.skipped",
          status: "skipped",
          severity: "healthy",
          recommendedAction: "wait",
          message: "Late subtitle lookup skipped (already in flight)",
          titleId: title.id,
          season: episode.season,
          episode: episode.episode,
          context: { reason: "already-in-flight" },
        }),
      );
      return;
    }
    PlaybackPhase.lateSubtitleInflight.add(inflightKey);

    diagnosticsService.record(
      buildSubtitleDiagnosticEvent({
        operation: "subtitle.lookup.started",
        status: "started",
        severity: "healthy",
        recommendedAction: "wait",
        message: "Late subtitle lookup started",
        titleId: title.id,
        season: episode.season,
        episode: episode.episode,
        context: {
          titleId: title.id,
          type: title.type,
          season: episode.season,
          episode: episode.episode,
          requestedSubLang,
        },
      }),
    );

    void (async () => {
      try {
        const result = await resolveSubtitlesByTmdbId({
          tmdbId,
          type: title.type,
          season: title.type === "series" ? episode.season : undefined,
          episode: title.type === "series" ? episode.episode : undefined,
          preferredLang: requestedSubLang,
          signal: iterationSignal,
        });

        if (iterationSignal.aborted || result.outcome === "cancelled") return;
        if (result.list.length === 0) {
          diagnosticsService.record(
            buildSubtitleDiagnosticEvent({
              operation: result.failed ? "subtitle.lookup.failed" : "subtitle.lookup.empty",
              status: result.failed ? "failed" : "skipped",
              severity: result.failed ? "recoverable" : "degraded",
              failureClass: result.failed ? "unknown" : undefined,
              recommendedAction: result.failed ? undefined : "none",
              message: result.failed ? "Late subtitle lookup failed" : "Late subtitle lookup empty",
              titleId: title.id,
              season: episode.season,
              episode: episode.episode,
              context: {
                titleId: title.id,
                requestedSubLang,
                failed: result.failed,
                outcome: result.outcome,
              },
            }),
          );
          return;
        }

        const mergedSubtitleList = mergeSubtitleTracks(
          stream.subtitleList,
          result.list as unknown as SubtitleTrack[],
        );
        const selected = selectAutomaticSubtitle(mergedSubtitleList as never, requestedSubLang);
        const selectedUrl = selected?.url ?? result.selected ?? null;
        if (!selectedUrl) {
          diagnosticsService.record(
            buildSubtitleDiagnosticEvent({
              operation: "subtitle.lookup.no-selectable-url",
              status: "failed",
              severity: "recoverable",
              failureClass: "parse",
              message: "Late subtitle lookup found tracks but no selectable URL",
              titleId: title.id,
              season: episode.season,
              episode: episode.episode,
              context: { titleId: title.id, trackCount: mergedSubtitleList.length },
            }),
          );
          return;
        }

        const attached = await this.attachLateSubtitlesWhenPlayerReady(context, {
          primarySubtitle: selectedUrl,
          subtitleTracks: mergedSubtitleList,
          playbackIterationSignal,
        });
        if (!attached) return;

        const currentState = stateManager.getState();
        if (
          currentState.currentTitle?.id === title.id &&
          currentState.currentEpisode?.season === episode.season &&
          currentState.currentEpisode?.episode === episode.episode
        ) {
          stateManager.dispatch({
            type: "SET_STREAM",
            stream: {
              ...stream,
              subtitle: selectedUrl,
              subtitleList: mergedSubtitleList,
              subtitleSource: "wyzie",
              subtitleEvidence: {
                directSubtitleObserved: Boolean(stream.subtitleList?.length),
                wyzieSearchObserved: true,
                reason: "wyzie-selected",
              },
            },
          });
        }

        diagnosticsService.record(
          buildSubtitleDiagnosticEvent({
            operation: "subtitle.attach.outcome",
            status: "succeeded",
            severity: "healthy",
            recommendedAction: "none",
            message: "Late subtitle lookup attached tracks",
            titleId: title.id,
            context: {
              titleId: title.id,
              outcome: "attached",
              delivery: "late",
              trackCount: mergedSubtitleList.length,
            },
          }),
        );
      } catch (error) {
        if (iterationSignal.aborted) return;
        logger.warn("Late subtitle lookup failed", { error: String(error) });
        diagnosticsService.record(
          buildSubtitleDiagnosticEvent({
            operation: "subtitle.lookup.failed",
            status: "failed",
            severity: "recoverable",
            failureClass: "unknown",
            message: "Late subtitle lookup failed",
            titleId: title.id,
            context: { titleId: title.id, error: String(error) },
          }),
        );
      } finally {
        PlaybackPhase.lateSubtitleInflight.delete(inflightKey);
      }
    })();
  }

  private async attachLateSubtitlesWhenPlayerReady(
    context: PhaseContext,
    attachment: {
      primarySubtitle: string;
      subtitleTracks: readonly SubtitleTrack[];
      playbackIterationSignal?: AbortSignal;
    },
  ): Promise<boolean> {
    const player = context.container.playerControl;
    const iterationSignal = attachment.playbackIterationSignal ?? context.signal;
    const deadline = Date.now() + 30_000;

    while (!iterationSignal.aborted && Date.now() < deadline) {
      let active = player.getActive();
      if (!active) {
        active = await player.waitForActivePlayer({
          signal: iterationSignal,
          timeoutMs: Math.max(0, deadline - Date.now()),
        });
        if (!active) return false;
      }

      const attached = await player.attachLateSubtitles(attachment, "late-subtitle-resolver");
      if (attached) return true;

      await Bun.sleep(250);
    }
    context.container.diagnosticsService.record(
      buildSubtitleDiagnosticEvent({
        operation: "subtitle.attach.outcome",
        status: "timed-out",
        severity: "recoverable",
        failureClass: "timeout",
        message: "Late subtitle attachment timed out waiting for player",
        context: {
          outcome: "player-ready-timeout",
          delivery: "late",
          trackCount: attachment.subtitleTracks.length,
        },
      }),
    );
    return false;
  }

  private async getAnimeEpisodeOptions({
    title,
    mode,
    provider,
    cache,
    signal,
  }: {
    title: TitleInfo;
    mode: import("../../domain/types").ShellMode;
    provider: import("../../services/providers/Provider").Provider | undefined;
    cache: Map<string, readonly EpisodePickerOption[] | undefined>;
    signal?: AbortSignal;
  }): Promise<readonly EpisodePickerOption[] | undefined> {
    const cacheKey =
      provider && title ? `${provider.metadata.id}:${title.id}` : provider?.metadata.id;
    if (cacheKey && cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }

    const result = await this.loadAnimeEpisodeOptions(title, mode, provider, signal);
    // Never cache a failed/aborted load: a cancelled resolve would otherwise
    // pin the episode picker to its 1-entry fallback for the whole session.
    if (cacheKey && result !== undefined) {
      cache.set(cacheKey, result);
    }
    return result;
  }

  private async loadAnimeEpisodeOptions(
    title: TitleInfo,
    mode: import("../../domain/types").ShellMode,
    provider: import("../../services/providers/Provider").Provider | undefined,
    signal?: AbortSignal,
  ): Promise<readonly EpisodePickerOption[] | undefined> {
    if (
      (mode !== "anime" && mode !== "youtube") ||
      title.type !== "series" ||
      !provider?.listEpisodes
    ) {
      return undefined;
    }

    try {
      return (await provider.listEpisodes({ title }, signal)) ?? undefined;
    } catch {
      return undefined;
    }
  }
}
