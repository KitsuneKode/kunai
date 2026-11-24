// =============================================================================
// One playback loop iteration
//
// Resolves the current episode (local file or provider), plays it, records
// history, then decides what happens next: recover/fail over, act on the
// player's control action, auto-advance, Up Next, or the post-play menu.
// Returns NEXT_ITERATION to run the loop again, or the phase result.
// =============================================================================

import { openTracksPanel, openPlaybackEpisodePicker } from "@/app-shell/workflows";
import { episodeInfoFromSelection } from "@/app/bootstrap/episode-info-from-catalog";
import { resolveTitleHistoryLookupId } from "@/app/bootstrap/title-info";
import { confirmPlaybackStart } from "@/app/playback/confirmed-playback-start";
import { resolveLocalEpisodePlayback } from "@/app/playback/episode-playback-source";
import {
  adoptEpisodePrefetchBundle,
  EpisodePrefetchHandle,
  isEpisodePrefetchEligible,
  type EpisodePrefetchProgress,
  type EpisodePrefetchTarget,
} from "@/app/playback/episode-prefetch";
import {
  dismissMpvTransitionOverlay,
  MAX_AUTO_SOURCE_RECOVER_ATTEMPTS,
  releasePersistentMpvForTerminalFailure,
  shouldReleasePersistentMpvBeforePostPlay,
} from "@/app/playback/mpv-session-lifecycle";
import { planCatalogAutoAdvance } from "@/app/playback/playback-catalog-autoadvance";
import { playbackDeadStreamScopeKey } from "@/app/playback/playback-dead-stream-ledger";
import { getAnimeEpisodeOptions } from "@/app/playback/playback-episode-catalog";
import { buildPlaybackEpisodePickerOptions } from "@/app/playback/playback-episode-picker";
import { episodeIdentityForHistory } from "@/app/playback/playback-history-identity";
import { createPlaybackIteration } from "@/app/playback/playback-iteration";
import { resolvePlaylistAutoNextCountdown } from "@/app/playback/playback-outcome";
import {
  updatePlaybackFeedback,
  transitionPlaybackSession,
  showPlaybackProblem,
} from "@/app/playback/playback-phase-feedback";
import {
  type PlaybackLoopState,
  NEXT_ITERATION,
  type PlaybackIterationStep,
} from "@/app/playback/playback-phase-session";
import { launchPlayback } from "@/app/playback/playback-player-launch";
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
import { clearPresenceInBackground } from "@/app/playback/playback-presence-writer";
import {
  playbackAudioPreference,
  playbackEpisodeCatalogLanguages,
  playbackQualityPreference,
  playbackSubtitlePreference,
} from "@/app/playback/playback-profile-context";
import {
  isProviderIdFallbackEligible,
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
  didPlaybackFailToStart,
  resolvePlaybackResultDecision,
  syncPlaybackSessionState,
} from "@/app/playback/playback-session-controller";
import { resolvePlaybackSourceAuthority } from "@/app/playback/playback-source-authority";
import { invalidateEpisodePlaybackCaches } from "@/app/playback/playback-source-cache-invalidation";
import {
  listOrderedPlaybackSourceIds,
  planStartupFailover,
  shouldUseProviderPlaybackRecovery,
} from "@/app/playback/playback-source-failover";
import {
  startAtResumePoint,
  startEpisodeNavigation,
  startFromBeginning,
} from "@/app/playback/playback-start-intent";
import {
  preparePlaybackStream,
  resolveEpisodePrefetchBundle,
} from "@/app/playback/playback-stream-prepare";
import { shouldFetchPlaybackTiming } from "@/app/playback/playback-timing-fetch-policy";
import {
  playbackTimingCacheKey,
  retryTimingInBackground,
  getPlaybackTimingMetadata,
} from "@/app/playback/playback-timing-lookup";
import {
  applyPlaybackControlTrackSelection,
  buildTrackOverrideDiagnosticContext,
} from "@/app/playback/playback-track-selection-policy";
import { type AutoAdvanceGuards } from "@/app/playback/policies/auto-advance-policy";
import { summarizeStartupStreamSource } from "@/app/playback/policies/startup-stage-policy";
import {
  isRecentPlaybackStreamFresh,
  recentPlaybackStreamKey,
  recentPlaybackStreamMatchesProvider,
  restoreRecentPlaybackStream,
  type RecentPlaybackStreamProvenance,
} from "@/app/playback/recent-playback-stream";
import {
  audioFallbackNoticeFromTrace,
  createResolveTraceStub,
  finalizeResolveTrace,
} from "@/app/playback/resolve-trace";
import { planEpisodeIterationDirective } from "@/app/playback/run-playback-episode-iteration";
import {
  applyPreferredStreamSelection,
  buildPlaybackControlSummary,
  shouldOfferPrePlayConfirm,
  streamSelectionFromTrackPick,
  type StreamSelectionIntent,
} from "@/app/playback/source-quality";
import { resolveSourceRefreshDecision } from "@/app/playback/source-refresh-policy";
import { applyTrackPickRestart } from "@/app/playback/track-pick-restart";
import { runAutoplayAdvanceCountdown } from "@/app/post-play/autoplay-advance-countdown";
import { PostPlaybackRecommendationRail } from "@/app/post-play/post-playback-recommendations";
import { classifyPersistedKind } from "@/domain/media/content-kind";
import type { MediaItemIdentity } from "@/domain/media/media-item-identity";
import { enrichExternalIdsWithVideoMeta } from "@/domain/media/video-meta";
import { decodeEpisodeSelectionValue } from "@/domain/playback/episode-selection";
import { shouldPersistHistory, toHistoryTimestamp } from "@/domain/playback/playback-history";
import {
  didPlaybackReachCompletionThreshold,
  resolveEpisodeAvailability,
  shouldMarkEpisodeCompleted,
  toEpisodeNavigationState,
} from "@/domain/playback/playback-policy";
import {
  buildLocalPlaybackFailureProblem,
  buildOfflineFileUnavailableProblem,
  buildPlayerFailureProblem,
  buildProviderResolveProblem,
} from "@/domain/playback/playback-problem";
import {
  evaluateProgressEngage,
  trustedProgressFromPlaybackResult,
} from "@/domain/playback/progress-engage-policy";
import {
  describeProviderFallbackDetail,
  describeProviderFallbackHaltedDetail,
  describeProviderFallbackHaltedNote,
  describeProviderHedgeDetail,
  describeProviderHedgeNote,
  describeProviderResolveAttemptDetail,
  describeProviderResolveAttemptNote,
} from "@/domain/playback/provider-resolve-copy";
import { decideSoftFallbackOnResolve } from "@/domain/playback/soft-fallback-preference-policy";
import type { DecodedTrackSelection } from "@/domain/playback/track-capabilities";
import { formatQueueEntryLabel } from "@/domain/queue/queue-entry-label";
import type { EpisodeInfo, StreamInfo, PlaybackResult, SearchResult } from "@/domain/types";
import { isDetachedHandoffResult } from "@/domain/types";
import { PlaybackAbortedError } from "@/infra/player/playback-aborted";
import { classifyPlaybackFailureFromResult } from "@/infra/player/playback-failure-classifier";
import { extractProviderNativeTiming, mergeTimingMetadata } from "@/infra/timing";
import { fetchTitleDetail, peekTitleDetail } from "@/services/catalog/TitleDetailService";
import { runBackgroundTask } from "@/services/diagnostics/background-task";
import {
  createCorrelationId,
  type DiagnosticCorrelation,
} from "@/services/diagnostics/correlation";
import { buildRecoveryDiagnosticEvent } from "@/services/diagnostics/diagnostic-event-helpers";
import { queueHistoryMirror } from "@/services/media-actions/create-container-media-action-router";
import { observeResolveNetworkOutcome } from "@/services/network/network-observation";
import { listReadyEpisodes } from "@/services/offline/offline-episode-index";
import { findNextReadyEpisode } from "@/services/offline/offline-episode-index";
import {
  createPlaybackStartupTimeline,
  formatPlaybackStartupTimeline,
  formatStartupPhaseBreakdown,
  type PlaybackStartupStage,
  summarizeStartupPhases,
} from "@/services/playback/playback-startup-timeline";
import {
  isProviderFallbackEligible,
  resolveEffectiveProviderHealth,
} from "@/services/playback/provider-health-policy";
import { enqueueReleaseReconciliation } from "@/services/release-reconciliation/enqueue-release-reconciliation";
import { fetchEpisodes, fetchSeasons } from "@/tmdb";
import type { ResolveAttempt } from "@kunai/core";
import type { ProviderFailure, ProviderId } from "@kunai/types";

export async function runEpisodeIteration(loop: PlaybackLoopState): Promise<PlaybackIterationStep> {
  const {
    context,
    host,
    title,
    run,
    isOfflineLaunch,
    animeEpisodeCatalogByProvider,
    playbackTimingByEpisode,
    selectionCoordinator,
    sourceRefreshCooldown,
    queueAttempt,
    getPreferredStreamSelection,
    setPreferredStreamSelection,
    historyTitleLookup,
    episodePrefetch,
    recentEpisodeStreams,
    deadStreamUrls,
    navigatePlaybackEpisode,
    invalidateRecentEpisodeStream,
    recentStreamMatchesPreferred,
    prepareStreamSwitchRestart,
  } = loop;
  const { container } = context;
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

  if (context.signal.aborted) {
    stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
    host.ledger.discard();
    await container.player.releasePersistentSession();
    return { status: "cancelled" };
  }

  loop.previousIterationAbort?.abort();
  const playbackIterationAbort = new AbortController();
  loop.previousIterationAbort = playbackIterationAbort;
  run.localEpisodeTiming = null;
  run.localPlaybackJobId = null;
  run.localPlaybackSource = null;
  const currentEpisode = stateManager.getState().currentEpisode;
  // No episode left to play: the loop ends and the phase returns to search.
  if (!currentEpisode) return { status: "success", value: "back_to_search" };
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
  run.playbackSession = transitionPlaybackSession(context, run.playbackSession, "resolve-started", {
    titleId: title.id,
    season: currentEpisode.season,
    episode: currentEpisode.episode,
    provider: stateManager.getState().provider,
  });

  const resolveController = new AbortController();
  let resolveAbortIntent: "cancel" | "fallback" | "retry" | null = null;
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
        updatePlaybackFeedback(context, {
          detail:
            resolveAbortIntent === "fallback"
              ? "Skipping current provider…"
              : resolveAbortIntent === "retry"
                ? "Restarting resolve…"
                : "Cancelling…",
          note:
            resolveAbortIntent === "fallback"
              ? "Trying the next compatible provider"
              : resolveAbortIntent === "retry"
                ? "Refreshing provider sources"
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
      resolveAbortIntent = reason?.includes("fallback")
        ? "fallback"
        : reason?.includes("recover") || reason?.includes("recompute")
          ? "retry"
          : "cancel";
      abortResolve(reason ?? "user-requested");
    },
  });

  try {
    const configuredProviderId = stateManager.getState().provider;
    if (run.sessionSoftProviderId && run.sessionSoftProviderId !== configuredProviderId) {
      run.sessionSoftProviderId = null;
    }
    const sourceAuthority = await resolvePlaybackSourceAuthority({
      configuredProviderId: run.sessionSoftProviderId ?? configuredProviderId,
      offlineOnly: isOfflineLaunch,
      resolveLocal: () =>
        resolveLocalEpisodePlayback(container, title, currentEpisode, {
          entrypoint: isOfflineLaunch
            ? "offline-library"
            : title.launchSource === "continue"
              ? "continue"
              : "online-search",
          forceOnline:
            !isOfflineLaunch &&
            (run.episodePlaybackSourceOverride === "online" ||
              run.pendingSourceRefreshAction !== null),
          forceLocal: isOfflineLaunch || run.episodePlaybackSourceOverride === "local",
        }),
      getProvider: (id) => providerRegistry.get(id),
    });
    run.episodePlaybackSourceOverride = null;
    if (sourceAuthority.kind === "provider-unavailable") {
      return {
        status: "error",
        error: {
          code: "PROVIDER_UNAVAILABLE",
          message: `Provider ${sourceAuthority.providerId} not found`,
          retryable: false,
        },
      };
    }
    if (sourceAuthority.kind === "offline-unavailable") {
      stateManager.dispatch({ type: "SET_STREAM", stream: null });
      const problem = buildOfflineFileUnavailableProblem();
      stateManager.dispatch({ type: "SET_PLAYBACK_PROBLEM", problem });
      diagnosticsService.record({
        category: "playback",
        operation: "playback.source.local.unavailable",
        message: problem.userMessage,
        titleId: title.id,
        season: currentEpisode.season,
        episode: currentEpisode.episode,
        context: { cause: problem.cause, recommendedAction: problem.recommendedAction },
      });
      return { status: "success", value: "back_to_results" };
    }
    // Stored provider identity remains provenance for history/share; only
    // the provider arm below owns a registered runtime adapter.
    const sourceProviderId =
      sourceAuthority.kind === "local"
        ? sourceAuthority.resolution.source.providerId
        : sourceAuthority.provider.metadata.id;
    const localPlayback = sourceAuthority.kind === "local";

    const deadStreamScope = playbackDeadStreamScopeKey({
      titleId: title.id,
      season: currentEpisode.season,
      episode: currentEpisode.episode,
      providerEpisodeIdentity: currentEpisode.providerEpisodeIdentity,
      providerId: sourceProviderId,
    });
    const providerAttemptId = createCorrelationId("provider");
    const playbackCorrelation: DiagnosticCorrelation = {
      sessionId: container.sessionId,
      playbackCycleId: createCorrelationId("playback"),
      providerAttemptId,
      traceId: providerAttemptId,
    };
    const startupTimeline = createPlaybackStartupTimeline({
      source: { providerId: localPlayback ? "local" : sourceProviderId },
    });
    let resolvedProviderId = sourceProviderId;
    const completeSourceTrackPick = async (
      pickedEpisode: EpisodeInfo,
      picked: DecodedTrackSelection,
      selection: StreamSelectionIntent | null,
      resumeSeconds: number,
      reason: string,
    ): Promise<ReturnType<typeof startEpisodeNavigation> | null> => {
      const { resolveTracksPanelPick } = await import("@/app/playback/tracks-panel-pick");
      const resolved = await resolveTracksPanelPick(picked, selection, {
        container,
        title,
        episode: pickedEpisode,
        currentProviderId: resolvedProviderId,
        playbackSourceKind: sourceAuthority.kind,
        resumeSeconds,
        reason,
      });

      if (resolved.kind === "noop" && sourceAuthority.kind === "local") return null;

      const restart = await applyTrackPickRestart({
        resolved,
        currentProviderId: resolvedProviderId,
        episode: pickedEpisode,
        resumeSeconds,
        effects: {
          applyManualSourcePick: (providerId, targetEpisode, sourceId) =>
            selectionCoordinator.applyManualSourcePick(providerId, targetEpisode, sourceId),
          applyEpisodeSelection: (providerId, targetEpisode, streamSelection) =>
            selectionCoordinator.applyEpisodeSelection(providerId, targetEpisode, streamSelection),
          invalidateRecentEpisodeStream,
          prepareStreamSwitchRestart,
        },
      });

      resolvedProviderId = restart.resolvedProviderId;
      if (restart.requiresFreshResolve) {
        run.pendingSourceRefreshAction = "recover";
        run.pendingRecomputeSources = false;
      }
      if (restart.notice) {
        updatePlaybackFeedback(context, { note: restart.notice });
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
    const playbackNetworkAllowed = !localPlayback && container.connectivity.isOnline();

    // Warm the catalog-detail cache early so the playback/post-play panels
    // can read it. On resolve we dispatch SET_TITLE_DETAIL so the UI reacts
    // (the rail reads SessionState.titleDetail). Errors are swallowed; the
    // panels fall back to honest placeholders if it never resolves.
    if (!localPlayback) {
      void fetchTitleDetail(title.id, title.type, undefined, {
        externalIds: title.externalIds,
        isAnime: stateManager.getState().mode === "anime" || title.isAnime === true,
      })
        .then((detail) => {
          stateManager.dispatch({
            type: "SET_TITLE_DETAIL",
            titleId: title.id,
            titleType: detail.type,
            detail,
          });
          return undefined;
        })
        .catch(() => undefined);
    }

    // Kick off timing fetch in parallel with everything else — IntroDB is a
    // lightweight API call and should resolve well before stream resolution.
    // Uses the configured provider for the warm path; after resolve we re-key
    // on the successful provider when they differ.
    recordStartupMark("timing-fetch-started");
    const configuredTimingProviderId = localPlayback ? undefined : sourceProviderId;
    const timingFetch = shouldFetchPlaybackTiming({
      networkAllowed: playbackNetworkAllowed,
      hasTiming: false,
    })
      ? getPlaybackTimingMetadata(
          title,
          currentEpisode,
          playbackTimingByEpisode,
          resolveController.signal,
          stateManager.getState().mode === "anime",
          configuredTimingProviderId,
          container.diagnosticsService,
        )
      : Promise.resolve(null);

    const watchedEntries = historyRepository.listByTitleIdentity(historyTitleLookup);
    const playbackMode = stateManager.getState().mode;
    const isAnimePlayback = playbackMode === "anime";
    const episodeLoadCache = new Map<string, Promise<Awaited<ReturnType<typeof fetchEpisodes>>>>();
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
    updatePlaybackFeedback(context, {
      detail: localPlayback ? "Preparing downloaded episode" : "Preparing episode metadata",
      note: localPlayback
        ? "Reading local files and episode navigation"
        : "Warming episode names, navigation, and artwork",
    });

    const currentAnimeEpisodesPromise =
      sourceAuthority.kind === "local"
        ? Promise.resolve(undefined)
        : getAnimeEpisodeOptions({
            title,
            mode: playbackMode,
            provider: sourceAuthority.provider,
            cache: animeEpisodeCatalogByProvider,
            languages: playbackEpisodeCatalogLanguages({ mode: playbackMode, title, config }),
            signal: resolveController.signal,
          });
    // The picker's downloaded marks and the autoplay cursor below must ask
    // for the same id an asset is filed under; canonicalising here on its
    // own left an enriched title looking up an id no asset row holds.
    const offlineTitleId = container.offlineTitleIdentity.resolveForTitle(title, playbackMode);
    const downloadedEpisodes = new Set(
      container.offlineAssetService
        .listTitleAssets(offlineTitleId)
        .filter((asset) => asset.state === "ready")
        .map((asset) => `${asset.season ?? 1}:${asset.episode ?? 1}`),
    );
    // Continue-path titles rebuilt from history often lack episodeCount;
    // the cached catalog detail knows it, so the picker never collapses
    // to a single "Episode N" entry when the provider list is missing.
    const knownEpisodeCount =
      title.episodeCount ?? peekTitleDetail(title.id, title.type)?.episodeCount;
    const shellEpisodePickerPromise = currentAnimeEpisodesPromise.then((currentAnimeEpisodes) =>
      buildPlaybackEpisodePickerOptions({
        title,
        currentEpisode,
        isAnime: isAnimePlayback,
        networkAllowed: playbackNetworkAllowed,
        animeEpisodeCount: knownEpisodeCount,
        animeEpisodes: currentAnimeEpisodes,
        watchedEntries,
        downloadedEpisodes,
        localEpisodes: localPlayback
          ? listReadyEpisodes(container.offlineAssetService, offlineTitleId)
          : undefined,
        loadEpisodes: loadEpisodesOnce,
      }),
    );
    const episodeAvailabilityPromise = localPlayback
      ? // Availability comes from the offline library, not the catalog. An
        // all-null answer here reads as "series finished" to
        // playback-result-policy, so downloaded E1 would never advance to
        // downloaded E2 and `n` would be dead. This keeps the launch free
        // of TMDB/anime-catalog calls while still answering truthfully.
        Promise.resolve({
          previousEpisode: null,
          nextEpisode: findNextReadyEpisode(
            container.offlineAssetService,
            offlineTitleId,
            currentEpisode,
          ),
          nextSeasonEpisode: null,
          upcomingNext: null,
          animeNextReleaseUnknown: false,
          tmdbUnavailable: false,
        })
      : currentAnimeEpisodesPromise.then((currentAnimeEpisodes) =>
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
    const [currentAnimeEpisodes, shellEpisodePicker, episodeAvailability] = await Promise.all([
      currentAnimeEpisodesPromise,
      shellEpisodePickerPromise,
      episodeAvailabilityPromise,
    ]);
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

    let stream: StreamInfo | null =
      sourceAuthority.kind === "local" ? sourceAuthority.resolution.stream : null;
    let streamProvenance: RecentPlaybackStreamProvenance = localPlayback ? "local" : "fresh";
    let consumedBundle: ReturnType<EpisodePrefetchHandle["takeReadyFor"]> = null;
    let prefetchWasPrepared = false;
    const profileContext = {
      overrides: stateManager.getState().playbackTrackPreferences,
      mode: stateManager.getState().mode,
      title,
      config,
    };

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
    if (sourceAuthority.kind === "local") {
      const local = sourceAuthority.resolution;
      run.localEpisodeTiming = local.timing;
      run.localPlaybackJobId = local.jobId;
      run.localPlaybackSource = local.source;
      run.pendingSourceRefreshAction = null;
      run.pendingRecomputeSources = false;
      diagnosticsService.record({
        ...playbackCorrelation,
        category: "playback",
        operation: "playback.source.local",
        message: "Using verified local file for episode playback",
        titleId: title.id,
        season: currentEpisode.season,
        episode: currentEpisode.episode,
        context: { jobId: local.jobId },
      });
    }
    if (sourceAuthority.kind === "provider") {
      updatePlaybackFeedback(context, {
        detail: "Resolving provider stream",
        note: "Esc cancel · returns to results",
      });

      const sourceRefreshAction = run.pendingSourceRefreshAction;
      run.pendingSourceRefreshAction = null;
      const recomputeSources = run.pendingRecomputeSources;
      run.pendingRecomputeSources = false;
      await selectionCoordinator.hydrate(sourceProviderId, currentEpisode);
      const currentPreferredStreamSelection = getPreferredStreamSelection(
        sourceProviderId,
        currentEpisode,
      );
      const sourceRefreshDecision = sourceRefreshAction
        ? resolveSourceRefreshDecision(sourceRefreshCooldown, {
            action: sourceRefreshAction,
            scope: {
              titleId: title.id,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
              providerId: sourceProviderId,
              sourceId: currentPreferredStreamSelection.sourceId,
              streamId: currentPreferredStreamSelection.streamId,
            },
            now: new Date(),
            cooldownMs: 30_000,
          })
        : null;

      if (sourceRefreshDecision?.kind === "cooldown") {
        updatePlaybackFeedback(context, {
          detail: sourceRefreshDecision.message,
          note: "The current stream can be reused without another provider lookup.",
        });
        diagnosticsService.record({
          ...playbackCorrelation,
          category: "playback",
          operation: "playback.refresh.cooldown",
          message: sourceRefreshDecision.message,
          providerId: sourceProviderId,
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
          providerId: sourceProviderId,
          titleId: title.id,
          season: currentEpisode.season,
          episode: currentEpisode.episode,
        });
      }

      // A user provider switch must not be answered by a bundle prefetched
      // for the provider they just left.
      const providerSwitchSeq = stateManager.getState().providerSwitchSeq;
      const pendingUserProviderSwitch = providerSwitchSeq !== loop.consumedProviderSwitchSeq;
      if (pendingUserProviderSwitch) {
        loop.consumedProviderSwitchSeq = providerSwitchSeq;
        run.sessionSoftProviderId = null;
      }

      // Use a prefetched bundle (resolve + optional subtitle prep during near-EOF)
      // or fall back to a full provider resolve. Explicit refresh/recover bypasses
      // prefetch so it can ask the provider for a fresh source.
      consumedBundle =
        sourceRefreshDecision || pendingUserProviderSwitch
          ? null
          : episodePrefetch.takeReadyFor(buildPrefetchTarget(currentEpisode, sourceProviderId));
      prefetchWasPrepared = consumedBundle?.prepared === true;

      stream = consumedBundle?.stream ?? null;
      streamProvenance = consumedBundle ? "prefetch" : "fresh";
      let resolveAttempts: readonly ResolveAttempt<StreamInfo>[] = [];
      if (stream) recordStartupMark("resolve-complete", stream);

      const resolveTrace = createResolveTraceStub({
        title,
        episode: currentEpisode,
        providerId: sourceProviderId,
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

      // Check in-memory cache for recently played episodes (backward navigation).
      // This lets P-navigation reuse the exact same StreamInfo without any
      // provider resolve, cache lookup, or health check.
      if (!stream && !sourceRefreshDecision) {
        const recentKey = recentPlaybackStreamKey(title.id, currentEpisode);
        const recent = recentEpisodeStreams.get(recentKey);
        if (
          recent?.provenance !== "local" &&
          recentPlaybackStreamMatchesProvider(recent, sourceProviderId, currentEpisode) &&
          recentStreamMatchesPreferred(recent, sourceProviderId, currentEpisode) &&
          isRecentPlaybackStreamFresh(recent)
        ) {
          const restored = restoreRecentPlaybackStream(recent);
          stream = restored.stream;
          resolvedProviderId = restored.resolvedProviderId;
          streamProvenance = restored.provenance;
          run.localPlaybackSource = restored.localPlaybackSource;
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
            providerId: sourceProviderId,
            providerManifest: container.providerRegistry.getManifest(sourceProviderId),
            title,
            episode: currentEpisode,
            mode: stateManager.getState().mode,
            config,
            overrides: stateManager.getState().playbackTrackPreferences,
            selectedSourceId: currentPreferredStreamSelection.sourceId,
            selectedStreamId: currentPreferredStreamSelection.streamId,
          });
        }
        const titlePreferredProviderId = resolveTitleProviderPreference(config.getRaw(), title.id);
        const resolveResult = await container.playbackResolveWork.resolve(
          {
            title,
            episode: currentEpisode,
            mode: stateManager.getState().mode,
            providerId: sourceProviderId,
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
            preserveCachedStreamOnFreshFailure: resolvePolicy.preserveCachedStreamOnFreshFailure,
            ignoreTitleHealthSuggestion: resolvePolicy.ignoreTitleHealthSuggestion,
            ignoreProviderHealth: resolvePolicy.ignoreProviderHealth,
            resolveIntent: resolvePolicy.resolveIntent,
            blockedStreamUrls: deadStreamUrls.list(deadStreamScope),
            signal: resolveController.signal,
            correlation: playbackCorrelation,
            onFeedback: (feedback) => {
              if (resolveController.signal.aborted) return;
              updatePlaybackFeedback(context, feedback);
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
                updatePlaybackFeedback(context, {
                  detail: "No fresher source found. Continuing current stream.",
                  note: "The cached stream stayed available, so playback can resume.",
                });
                return;
              }

              if (event.type === "title-provider-suggestion") {
                const suggestedName =
                  providerRegistry.get(event.suggestedProviderId)?.metadata.name ??
                  event.suggestedProviderId;
                const strugglingName =
                  providerRegistry.get(event.providerId)?.metadata.name ?? event.providerId;
                updatePlaybackFeedback(context, {
                  note: `${strugglingName} struggled on this title before. ${suggestedName} worked — switch providers or retry ${strugglingName}.`,
                });
                return;
              }

              if (event.type === "provider-engine-event") {
                // Live fallback progress — the post-hoc attempt/failure
                // replay below narrates history; this is what the screen
                // should say while the chain is still running.
                const engineEvent = event.event;
                const engineProviderName = (id: string) =>
                  providerRegistry.get(id)?.metadata.name ?? id;
                if (engineEvent.type === "provider-fallback-started") {
                  updatePlaybackFeedback(context, {
                    detail: describeProviderFallbackDetail({
                      fromProviderName: engineProviderName(engineEvent.fromProviderId),
                      toProviderName: engineProviderName(engineEvent.toProviderId),
                    }),
                    note: "⇧F skips ahead if this provider stalls too.",
                  });
                } else if (engineEvent.type === "provider-hedge-started") {
                  updatePlaybackFeedback(context, {
                    // Name the parallel provider in the detail slot: the
                    // previous fallback sentence ("X did not resolve —
                    // trying Y") would otherwise sit stale on screen
                    // while the hedged provider is the live attempt.
                    detail: describeProviderHedgeDetail({
                      toProviderName: engineProviderName(engineEvent.toProviderId),
                    }),
                    note: describeProviderHedgeNote({
                      toProviderName: engineProviderName(engineEvent.toProviderId),
                    }),
                  });
                } else if (engineEvent.type === "provider-fallback-halted") {
                  updatePlaybackFeedback(context, {
                    detail: describeProviderFallbackHaltedDetail(),
                    note: describeProviderFallbackHaltedNote(),
                  });
                }
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
                updatePlaybackFeedback(context, {
                  detail: describeProviderResolveAttemptDetail(event),
                  note: describeProviderResolveAttemptNote(event),
                });
                return;
              }

              if (event.type === "failure") {
                updatePlaybackFeedback(context, {
                  detail: event.retryable
                    ? `Recoverable provider issue (${event.attempt}/${event.maxAttempts})`
                    : "Provider returned a non-recoverable issue",
                  note: event.issue,
                });
              } else if (event.type === "cache-stale") {
                updatePlaybackFeedback(context, {
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
        // The per-title preference guards the resolve only when the engine
        // landed somewhere the user did NOT ask for. A session-scoped
        // provider (⇧F fallback, per-session /provider) is itself the
        // current intent — resolving exactly it must not be rejected just
        // because an older durable preference still names another provider.
        if (
          stream &&
          pendingUserProviderSwitch &&
          titlePreferredProviderId &&
          resolvedProviderId !== titlePreferredProviderId &&
          resolvedProviderId !== stateManager.getState().provider
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
          updatePlaybackFeedback(context, {
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
              : resolveResult.providerId !== sourceProviderId
                ? "fallback"
                : "fresh";
        resolveAttempts = resolveResult.attempts;
        if (resolveAttempts.length > 0) {
          // Every provider the chain touched this cycle — successes,
          // failures, and aborted in-flight candidates — is marked tried
          // so a later ⇧F walks forward instead of looping back.
          stateManager.dispatch({
            type: "RECORD_FALLBACK_TRIED_PROVIDERS",
            providerIds: resolveAttempts.map((attempt) => attempt.providerId),
          });
        }
        if (stream) recordStartupMark("resolve-complete", stream);

        for (const [attemptIndex, attempt] of resolveAttempts.entries()) {
          diagnosticsService.record({
            ...playbackCorrelation,
            category: "provider",
            message: attempt.aborted
              ? "Provider resolve attempt aborted"
              : attempt.stream
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
          configuredProviderId: sourceProviderId,
          resolvedProviderId,
        });
        if (hop.kind === "session-soft-hop") {
          logger.info("Resolved stream with fallback provider", {
            from: sourceProviderId,
            fallback: hop.providerId,
          });
          run.sessionSoftProviderId = hop.providerId;
          host.ledger.current?.alignProvider(hop.providerId);
          const fallbackName =
            providerRegistry.get(hop.providerId)?.metadata.name ?? hop.providerId;
          updatePlaybackFeedback(context, {
            note: `Using ${fallbackName} for this session. /provider to switch back, then /recompute.`,
          });
        } else if (pendingUserProviderSwitch) {
          const streamProviderId = resolveStreamProviderId(stream);
          if (streamProviderId && streamProviderId === configuredProviderId) {
            updatePlaybackFeedback(context, {
              note: `Resolving via ${providerRegistry.get(configuredProviderId)?.metadata.name ?? configuredProviderId}.`,
            });
          }
        }

        if (stream?.providerResolveResult) {
          // Surface a silent audio downgrade (e.g. dub requested, only sub
          // available) so the user is told why the language changed rather
          // than just hearing the wrong one.
          const audioFallbackNote = audioFallbackNoticeFromTrace(
            stream.providerResolveResult.trace.events,
          );
          if (audioFallbackNote) {
            updatePlaybackFeedback(context, { note: audioFallbackNote });
          }
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

      // Every resolve path — prefetch, recent-stream reuse, and fresh or
      // fallback resolve — converges here, so each is recorded exactly
      // once. Recorded after the cancel guard above so an abandoned
      // resolve is not filed as a success. An empty `resolveAttempts` is
      // itself the signal that nothing was resolved live.
      container.resolveTraceSink.record(
        finalizeResolveTrace(resolveTrace, {
          endedAt: new Date().toISOString(),
          selectedProviderId: resolvedProviderId ?? sourceProviderId,
          selectedStreamId: stream?.providerResolveResult?.streams?.[0]?.id,
          cacheHit: streamProvenance === "cache",
          failures: resolveAttempts
            .map((attempt) => attempt.failure)
            .filter((failure): failure is ProviderFailure => failure !== undefined),
        }),
      );

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
        const titleSwitchSelection =
          streamSwitchAction === "switch-title"
            ? playerControl.consumePendingTitleSelection()
            : null;
        // Health-aware and tried-aware: a provider marked down or already
        // attempted in this cycle is not a viable fallback target even
        // though it stays selectable explicitly.
        const triedProviderIds = new Set(stateManager.getState().fallbackTriedProviderIds);
        const eligibleFallbackExists = providerRegistry
          .getCompatible(title, stateManager.getState().mode)
          .some(
            (candidate) =>
              candidate.metadata.id !== sourceProviderId &&
              !triedProviderIds.has(candidate.metadata.id) &&
              isProviderFallbackEligible(
                resolveEffectiveProviderHealth(
                  // SAFETY: candidate.metadata.id comes from a registered provider module — it is a ProviderId by contract.
                  container.providerHealth?.get(candidate.metadata.id as ProviderId),
                ),
              ),
          );
        const hasCompatibleFallbackProvider =
          resolveAborted && resolveAbortIntent === "fallback" ? eligibleFallbackExists : false;

        let problemAction: "dismiss" | "retry" | null = null;
        if (!resolveAborted) {
          const problem = buildProviderResolveProblem({
            attempts: resolveAttempts,
            capabilitySnapshot: container.capabilitySnapshot,
            fallbackAvailable: eligibleFallbackExists,
            hasStreamCandidates: resolveAttempts.some(
              (attempt) =>
                (attempt.result?.streams.length ?? 0) > 0 ||
                (attempt.result?.sources?.length ?? 0) > 0,
            ),
          });
          run.playbackSession = transitionPlaybackSession(
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
          problemAction = await showPlaybackProblem(context, problem);
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
          return NEXT_ITERATION;
        }

        if (iterationDirective.kind === "restart") {
          if (
            iterationDirective.reason === "stream-switch-during-resolve" &&
            streamSwitchSelection
          ) {
            await setPreferredStreamSelection(
              sourceProviderId,
              currentEpisode,
              streamSwitchSelection,
            );
            await prepareStreamSwitchRestart(currentEpisode);
            diagnosticsService.record({
              ...playbackCorrelation,
              category: "playback",
              message: "Stream selection applied during bootstrap resolve",
              providerId: sourceProviderId,
              titleId: title.id,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
              context: {
                action: streamSwitchAction,
                sourceId: streamSwitchSelection.sourceId,
                streamId: streamSwitchSelection.streamId,
              },
            });
            return NEXT_ITERATION;
          }

          if (iterationDirective.reason === "provider-fallback-skip") {
            // An explicit provider choice made while the resolve was in
            // flight (the picker dispatches SET_PROVIDER then cancels the
            // work) outranks the automatic "next untried" walk — the user
            // told us exactly where to go.
            const configuredProviderNow = stateManager.getState().provider;
            const explicitPick =
              configuredProviderNow !== sourceProviderId
                ? providerRegistry.get(configuredProviderNow)
                : undefined;
            const fallback =
              explicitPick ??
              pickCompatibleFallbackProvider({
                providers: providerRegistry.getCompatible(title, stateManager.getState().mode),
                currentProviderId: sourceProviderId,
                excludedProviderIds: triedProviderIds,
                isFallbackEligible: (providerId) =>
                  isProviderIdFallbackEligible(container, providerId),
              });
            if (fallback) {
              run.sessionSoftProviderId = null;
              stateManager.dispatch({
                type: "SET_PROVIDER",
                provider: fallback.metadata.id,
                forceFreshResolve: !explicitPick,
              });
              updatePlaybackFeedback(context, {
                detail: `Trying ${fallback.metadata.name ?? fallback.metadata.id}…`,
                note: "Fallback provider selected for the rest of this session",
              });
              diagnosticsService.record({
                category: "provider",
                message: "Skipping current provider during playback bootstrap",
                context: {
                  from: sourceProviderId,
                  fallback: fallback.metadata.id,
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                },
              });
              return NEXT_ITERATION;
            }
          }

          if (iterationDirective.reason === "resolve-retry") {
            run.pendingSourceRefreshAction = "recover";
            run.pendingRecomputeSources = true;
            run.autoSourceRecoverAttempts = 0;
            invalidateRecentEpisodeStream(currentEpisode);
            updatePlaybackFeedback(context, {
              detail: "Retrying with fresh provider sources…",
              note: "Cached failures and stale source inventory are bypassed for this attempt.",
            });
            return NEXT_ITERATION;
          }
        }

        if (resolveAborted) {
          stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
          stateManager.dispatch({ type: "SET_STREAM", stream: null });
          updatePlaybackFeedback(context, { detail: null, note: null });
          await dismissMpvTransitionOverlay(playerControl);
          if (titleSwitchSelection) {
            return {
              status: "success",
              value: {
                type: "history_entry",
                title: titleSwitchSelection.title,
                episode: titleSwitchSelection.episode,
              },
            };
          }
        } else {
          stateManager.dispatch({ type: "SET_STREAM", stream: null });
        }
        return { status: "success", value: "back_to_results" };
      }

      if (stream && streamProvenance !== "local") {
        const hop = decideSoftFallbackOnResolve({
          configuredProviderId: sourceProviderId,
          resolvedProviderId,
        });
        if (hop.kind === "session-soft-hop" && run.sessionSoftProviderId !== hop.providerId) {
          logger.info("Resolved stream with fallback provider", {
            from: sourceProviderId,
            fallback: hop.providerId,
          });
          run.sessionSoftProviderId = hop.providerId;
          host.ledger.current?.alignProvider(hop.providerId);
          const fallbackName =
            providerRegistry.get(hop.providerId)?.metadata.name ?? hop.providerId;
          updatePlaybackFeedback(context, {
            note: `Using ${fallbackName} for this session. /provider to switch back, then /recompute.`,
          });
        }
      }

      stream = applyPreferredStreamSelection(
        stream,
        getPreferredStreamSelection(sourceProviderId, currentEpisode),
        playbackQualityPreference(profileContext),
        playbackSubtitlePreference(profileContext),
        config.hdrMode,
      );
    }
    if (!stream || resolveController.signal.aborted) {
      stateManager.dispatch({ type: "SET_STREAM", stream: null });
      return { status: "success", value: "back_to_results" };
    }
    if (container.player.capabilities.observation === "managed") {
      // Fire-and-forget: a capability gap is advice, never a startup gate.
      const noticeStream = stream;
      void import("./hdr-capability-notice")
        .then(({ resolveHdrCapabilityNotice }) =>
          resolveHdrCapabilityNotice(noticeStream, config.hdrMode),
        )
        .then((note) => (note ? updatePlaybackFeedback(context, { note }) : undefined))
        .catch(() => undefined);
    }
    const providerHandoff =
      sourceAuthority.kind === "provider"
        ? resolvePlaybackProviderHandoff({
            configuredProviderId: sourceProviderId,
            successfulProviderId: resolvedProviderId,
          })
        : { successfulProviderId: sourceProviderId, nextEpisodeProviderId: sourceProviderId };

    // Await timing — stream resolve takes much longer so this is nearly free.
    // If IntroDB timed out and returned null, schedule a background retry that
    // injects timing into the running player once it arrives.
    recordStartupMark("timing-wait-started", stream);
    const successfulTimingProviderId = providerHandoff.successfulProviderId;
    const fetchedPlaybackTiming =
      run.localEpisodeTiming ??
      (successfulTimingProviderId === configuredTimingProviderId
        ? await timingFetch
        : shouldFetchPlaybackTiming({
              networkAllowed: playbackNetworkAllowed,
              hasTiming: false,
            })
          ? await getPlaybackTimingMetadata(
              title,
              currentEpisode,
              playbackTimingByEpisode,
              resolveController.signal,
              stateManager.getState().mode === "anime",
              successfulTimingProviderId,
              container.diagnosticsService,
            )
          : null);
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
    if (
      shouldFetchPlaybackTiming({
        networkAllowed: playbackNetworkAllowed,
        hasTiming: playbackTiming !== null,
      })
    ) {
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
          retryTimingInBackground(
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
        : await preparePlaybackStream(stream, title, currentEpisode, context);
    recordStartupMark("stream-prepared", preparedStream);
    stateManager.dispatch({ type: "SET_STREAM", stream: preparedStream });

    const episodeKey = recentPlaybackStreamKey(title.id, currentEpisode);
    if (streamProvenance === "local") {
      if (run.localPlaybackSource) {
        recentEpisodeStreams.set(episodeKey, {
          stream: preparedStream,
          episode: currentEpisode,
          selectedProviderId: sourceProviderId,
          resolvedProviderId,
          provenance: "local",
          localPlaybackSource: run.localPlaybackSource,
        });
      }
    } else {
      recentEpisodeStreams.set(episodeKey, {
        stream: preparedStream,
        episode: currentEpisode,
        selectedProviderId: sourceProviderId,
        resolvedProviderId,
        provenance: streamProvenance,
      });
    }
    if (recentEpisodeStreams.size > 5) {
      const first = recentEpisodeStreams.keys().next().value;
      if (first !== undefined) recentEpisodeStreams.delete(first);
    }
    stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "ready" });
    run.playbackSession = transitionPlaybackSession(context, run.playbackSession, "stream-ready", {
      titleId: title.id,
      season: currentEpisode.season,
      episode: currentEpisode.episode,
      provider: resolvedProviderId,
    });

    // Pre-play confirm: with `prePlayConfirm` armed, the resolved
    // inventory opens in the Tracks sheet before mpv launches so the
    // source/quality/track pick is deliberate, not auto-taken. The pick
    // becomes a restart intent through the same machinery the post-play
    // pick commands use; Esc falls through to the resolved default.
    if (
      !loop.prePlayConfirmOffered &&
      shouldOfferPrePlayConfirm(config.prePlayConfirm, buildPlaybackControlSummary(preparedStream))
    ) {
      loop.prePlayConfirmOffered = true;
      const picked = await openTracksPanel(preparedStream, {}, container);
      const selection = picked ? streamSelectionFromTrackPick(picked) : null;
      if (picked && (selection || picked.section === "subtitle")) {
        const resumeSeconds = run.pendingStart.startAt || run.pendingStart.resumePromptAt;
        const trackStart = await completeSourceTrackPick(
          currentEpisode,
          picked,
          selection,
          resumeSeconds,
          "pre-play-confirm",
        );
        if (trackStart) {
          run.pendingStart = trackStart;
          return NEXT_ITERATION;
        }
      }
    }

    // Play in MPV — consume the pending resume position on the first play only.
    // Pass loading handle so launchPlayback can update it in-place (no shell flicker).
    const startIntent = run.pendingStart;
    run.pendingStart = startFromBeginning();

    let prefetchedRecommendationItems: readonly SearchResult[] | null = null;
    let nextPrefetchProgress: EpisodePrefetchProgress = {};
    const buildNextPrefetchTarget = (): EpisodePrefetchTarget | null => {
      if (sourceAuthority.kind !== "provider") return null;
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
      if (sourceAuthority.kind !== "provider") return;
      await adoptEpisodePrefetchBundle({
        handle: episodePrefetch,
        target,
        run: (signal) => runNextEpisodePrefetch(signal, target),
        getProgress: () => nextPrefetchProgress,
        onWaiting: () =>
          updatePlaybackFeedback(context, {
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
      if (sourceAuthority.kind !== "provider") return Promise.resolve(null);
      const nextEp = target.episode;
      const prefetchMetadata = providerRegistry.get(target.providerId);
      if (!prefetchMetadata) {
        return Promise.resolve(null);
      }
      return resolveEpisodePrefetchBundle(context, {
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
      if (sourceAuthority.kind !== "provider" || container.config.powerSaverMode) {
        return;
      }
      if (
        !isEpisodePrefetchEligible({
          titleType: title.type,
          hasNextEpisode: Boolean(episodeAvailability.nextEpisode),
          stopAfterCurrent: run.playbackSession.stopAfterCurrent,
          sessionMode: run.playbackSession.mode,
          autoplayPaused: run.playbackSession.autoplayPaused,
          networkAllowed: playbackNetworkAllowed,
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
        !title.id.startsWith("youtube") &&
        // TMDB recommendations need a TMDB id. Anime titles carry AniList
        // ids (often bare numbers), which TMDB would read as an unrelated
        // show; anime post-play uses the AniList recommendations path.
        stateManager.getState().mode !== "anime" &&
        title.isAnime !== true
      ) {
        container.backgroundWorkScheduler.enqueue({
          id: `recommendation-prefetch:${title.type}:${title.id}`,
          lane: "recommendation-warm",
          signal: context.signal,
          run: async () => {
            const section = await container.recommendationService.getForTitle(title.id, title.type);
            prefetchedRecommendationItems = section.items.filter(
              (item) => item.title.trim().length > 0,
            );
          },
        });
        void container.backgroundWorkScheduler.drain();
      }
    };

    if (context.signal.aborted) {
      stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
      host.ledger.discard();
      await container.player.releasePersistentSession();
      return { status: "cancelled" };
    }

    let result: PlaybackResult;
    try {
      queueAttempt?.setStage("player-launch");
      result = await launchPlayback({
        stream: preparedStream,
        title,
        episode: currentEpisode,
        context,
        ledger: host.ledger,
        startAt: startIntent.startAt,
        resumePromptAt: startIntent.resumePromptAt,
        playbackMode: run.playbackSession.mode,
        timing: playbackTiming,
        onNearEof: maybePrefetchNext,
        suppressResumePrompt: startIntent.suppressResumePrompt,
        correlation: playbackCorrelation,
        onStartupMark: (stage) => recordStartupMark(stage, preparedStream),
        successfulProviderId: providerHandoff.successfulProviderId,
        playbackIterationSignal: playbackIterationAbort.signal,
        onConfirmedPlaybackStart: () => {
          run.playbackSession = confirmPlaybackStart({
            session: run.playbackSession,
            transition: (session, event) =>
              transitionPlaybackSession(context, session, event, {
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
                provider: resolvedProviderId,
              }),
            acknowledgeQueue: () => queueAttempt?.acknowledgeStarted(),
          });
        },
        localPlaybackSource: run.localPlaybackSource ?? undefined,
      });
      if (isDetachedHandoffResult(result)) {
        queueAttempt?.rollbackIfUnacknowledged(
          "playback-aborted",
          "external handoff is not observable",
        );
      }
    } catch (error) {
      run.pendingStart = startIntent;
      if (error instanceof PlaybackAbortedError || context.signal.aborted) {
        stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
        host.ledger.discard();
        await container.player.releasePersistentSession();
        return { status: "cancelled" };
      }
      throw error;
    }

    if (didPlaybackFailToStart(result) || result.watchedSeconds === 0) {
      run.pendingStart = startIntent;
    }

    if (context.signal.aborted) {
      stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
      host.ledger.discard();
      await container.player.releasePersistentSession();
      return { status: "cancelled" };
    }
    run.playbackSession = transitionPlaybackSession(
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
    if (
      container.player.capabilities.completion &&
      shouldPersistHistory(result, effectiveTiming.current, quitThresholdMode)
    ) {
      const didComplete = didPlaybackReachCompletionThreshold(
        result,
        effectiveTiming.current,
        quitThresholdMode,
      );
      // History durability: completed:true is forever — it clears the
      // resume point. Only a clean natural EOF sets it; voluntary quit,
      // kill, crash, timeout, or keep-open no-end-file stays resumable
      // even past the threshold.
      const shouldMarkCompleted = shouldMarkEpisodeCompleted(
        result,
        effectiveTiming.current,
        quitThresholdMode,
      );
      const evidence = trustedProgressFromPlaybackResult(result);
      const decision = evaluateProgressEngage(evidence, {
        reachedCompletionThreshold: didComplete,
      });
      let historyTimestamp = toHistoryTimestamp(result, effectiveTiming.current, quitThresholdMode);
      const persistedKind = classifyPersistedKind(title, stateManager.getState().mode, {
        providerId: resolvedProviderId,
      });
      const historyTitleId = resolveTitleHistoryLookupId(title, stateManager.getState().mode);
      const episodeIdentity = episodeIdentityForHistory(title, currentEpisode);
      const titleIdentity = {
        id: title.id,
        kind: persistedKind,
        title: title.name,
        externalIds: enrichExternalIdsWithVideoMeta(
          title.externalIds,
          stateManager.getState().videoMeta,
        ),
      };
      // One read serves both the did-not-start resume check and the
      // last-watched bump below: this teardown used to issue the same
      // identity lookup twice (~8 sequential queries each) per episode end.
      const existingProgress = container.historyRepository.getProgressForTitleIdentity(
        titleIdentity,
        episodeIdentity,
      );
      if (decision.isDidNotStart) {
        if (existingProgress && existingProgress.positionSeconds > 0) {
          historyTimestamp = existingProgress.positionSeconds;
        }
      }
      const lastWatchedAt = decision.shouldBumpLastWatched
        ? new Date().toISOString()
        : (existingProgress?.lastWatchedAt ?? existingProgress?.updatedAt ?? null);
      const activeLedger = host.ledger.current;
      if (activeLedger) {
        activeLedger.finalize({
          positionSeconds: historyTimestamp,
          durationSeconds: result.duration,
          completed: shouldMarkCompleted,
          providerId: resolvedProviderId,
          posterUrl: title.posterUrl,
          bumpLastWatched: decision.shouldBumpLastWatched,
        });
        host.ledger.release();
      } else {
        container.historyRepository.upsertProgress({
          title: titleIdentity,
          episode: episodeIdentity,
          positionSeconds: historyTimestamp,
          durationSeconds: result.duration,
          completed: shouldMarkCompleted,
          watchedSeconds: didComplete ? result.duration : historyTimestamp,
          lastWatchedAt,
          completedAt: shouldMarkCompleted ? new Date().toISOString() : null,
          providerId: resolvedProviderId,
          posterUrl: title.posterUrl,
          updatedAt: new Date().toISOString(),
        });
      }
      if (sourceAuthority.kind === "provider")
        await promoteSoftFallbackAfterEngage(container, {
          title,
          mode: stateManager.getState().mode,
          sessionSoftProviderId: run.sessionSoftProviderId,
          configuredProviderId: sourceProviderId,
          engaged: decision.isEngaged,
        });
      const savedHistoryRow = container.historyRepository.getLatestForTitle(historyTitleId);
      if (savedHistoryRow) {
        // Enqueued from the row that was actually persisted, not from the
        // in-flight result: the outbox must never describe progress the
        // local history does not have. This only writes SQLite — remote
        // delivery is the drain's job, so playback never waits on a
        // tracker, and repeated updates coalesce instead of stacking up.
        // Admission reads the live opt-in before it writes the outbox.
        // Keep that asynchronous check outside the playback teardown:
        // persistence is already complete and tracker work is optional.
        queueHistoryMirror(container, historyTitleId, savedHistoryRow);
      }
      if (playbackNetworkAllowed) {
        enqueueReleaseReconciliation(
          container,
          savedHistoryRow ? [savedHistoryRow] : [],
          "post-playback",
          context.signal,
        );
      }
      const providerSuggestion =
        sourceAuthority.kind === "provider"
          ? container.titleProviderHealth.getSwitchSuggestion(title.id, sourceProviderId)
          : null;
      if (providerSuggestion) {
        updatePlaybackFeedback(context, {
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
      if (shouldMarkCompleted) {
        const epStr =
          title.type === "series"
            ? ` S${String(currentEpisode.season).padStart(2, "0")}E${String(currentEpisode.episode).padStart(2, "0")}`
            : "";
        updatePlaybackFeedback(context, {
          note: `✓ ${title.name}${epStr} · episode complete`,
        });
        if (streamProvenance === "local" && run.localPlaybackJobId) {
          container.offlineRunwayService.enqueueEvaluation(title.id, "offline-playback-complete");
        }
      }
    } else {
      host.ledger.discard();
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

    const providerRecoveryAllowed =
      sourceAuthority.kind === "provider" && shouldUseProviderPlaybackRecovery(streamProvenance);
    const shouldInvalidateStreamCache =
      providerRecoveryAllowed &&
      (result.endReason === "error" ||
        result.suspectedDeadStream === true ||
        didPlaybackFailToStart(result));
    if (shouldInvalidateStreamCache) {
      const invalidateProviderId = providerHandoff.successfulProviderId;
      const selectedResolveStream = preparedStream.providerResolveResult?.streams.find(
        (candidate) => candidate.id === preparedStream.providerResolveResult?.selectedStreamId,
      );
      deadStreamUrls.record(
        playbackDeadStreamScopeKey({
          titleId: title.id,
          season: currentEpisode.season,
          episode: currentEpisode.episode,
          providerEpisodeIdentity: currentEpisode.providerEpisodeIdentity,
          providerId: invalidateProviderId,
        }),
        preparedStream.url,
      );
      await invalidateEpisodePlaybackCaches({
        cacheStore,
        sourceInventory: container.sourceInventory,
        providerId: invalidateProviderId,
        providerManifest: container.providerRegistry.getManifest(invalidateProviderId),
        title,
        episode: currentEpisode,
        mode: stateManager.getState().mode,
        config,
        overrides: stateManager.getState().playbackTrackPreferences,
        selectedSourceId: selectedResolveStream?.sourceId,
        selectedStreamId: preparedStream.providerResolveResult?.selectedStreamId,
      });
      invalidateRecentEpisodeStream(currentEpisode);
      if (result.suspectedDeadStream === true && result.streamRejectedBeforePlayerLaunch !== true) {
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
    if (playbackControlAction === "switch-title") {
      // A notification (or other handoff) asked to leave this title's
      // session entirely: the file stop already landed, so exit with the
      // target and let SessionController re-enter playback for it.
      const titleSelection = playerControl.consumePendingTitleSelection();
      if (titleSelection) {
        diagnosticsService.record({
          category: "playback",
          message: "Switching to a different title from active playback",
          context: {
            fromTitleId: title.id,
            toTitleId: titleSelection.title.id,
          },
        });
        return {
          status: "success",
          value: {
            type: "history_entry",
            title: titleSelection.title,
            episode: titleSelection.episode,
          },
        };
      }
    }
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
    let shouldAutoFallbackProvider =
      playbackDecision.shouldFallbackProvider && sourceAuthority.kind === "provider";
    if (!providerRecoveryAllowed && playbackDecision.shouldRefreshSource) {
      const isExplicitLocalRelaunch =
        playbackControlAction === "refresh" || playbackControlAction === "recover";
      if (isExplicitLocalRelaunch) {
        run.pendingStart = startAtResumePoint(
          toHistoryTimestamp(result, effectiveTiming.current, quitThresholdMode),
          { suppressResumePrompt: true },
        );
        run.episodePlaybackSourceOverride = "local";
        return NEXT_ITERATION;
      }

      const localProblem = buildLocalPlaybackFailureProblem();
      stateManager.dispatch({
        type: "SET_PLAYBACK_PROBLEM",
        problem: localProblem,
      });
      diagnosticsService.record({
        ...playbackCorrelation,
        category: "playback",
        operation: "playback.source.local.failed",
        level: "error",
        message: localProblem.userMessage,
        titleId: title.id,
        season: currentEpisode.season,
        episode: currentEpisode.episode,
        context: {
          cause: localProblem.cause,
          endReason: result.endReason,
          playerExitCode: result.playerExitCode,
        },
      });
      await releasePersistentMpvForTerminalFailure({
        player,
        playerControl,
        userMessage: localProblem.userMessage,
        reason: `local-playback:${classifyPlaybackFailureFromResult(result)}`,
        diagnostics: diagnosticsService,
      });
      return { status: "success", value: "back_to_results" };
    }

    if (providerRecoveryAllowed && playbackDecision.shouldRefreshSource) {
      const isExplicitSourceRefresh =
        playbackControlAction === "refresh" || playbackControlAction === "recover";
      const isAutoSourceRecover =
        !isExplicitSourceRefresh &&
        (result.suspectedDeadStream === true || didPlaybackFailToStart(result));

      const selectedResolveStream = preparedStream.providerResolveResult?.streams.find(
        (candidate) => candidate.id === preparedStream.providerResolveResult?.selectedStreamId,
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
        updatePlaybackFeedback(context, {
          detail: "Could not start playback",
          note: "Press o for sources, ⇧F for fallback, r to retry, or /diagnostics for details",
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
            pickCompatibleFallbackProvider({
              providers: providerRegistry.getCompatible(title, stateManager.getState().mode),
              currentProviderId: resolvedProviderId,
              excludedProviderIds: new Set(stateManager.getState().fallbackTriedProviderIds),
              isFallbackEligible: (providerId) =>
                isProviderIdFallbackEligible(container, providerId),
            }),
          ),
          failoverAttempts: run.autoSourceRecoverAttempts,
          maxFailoverAttempts: MAX_AUTO_SOURCE_RECOVER_ATTEMPTS,
          providerHopUsed: run.startupProviderHopUsed,
        });

        if (failoverPlan.kind === "advance-source") {
          await selectionCoordinator.applyAutomaticSourceFailover(
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
          void playerControl
            .getActive()
            ?.setEpisodeTransitionLoading?.(
              `Kunai · Server unreachable, switching to backup server (${failoverPlan.sourceId})…`,
            );
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
          updatePlaybackFeedback(context, {
            detail: "Could not start playback",
            note: "Press o for sources, ⇧F for fallback, r to retry, or /diagnostics for details",
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
        run.playbackSession = transitionPlaybackSession(
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
        return NEXT_ITERATION;
      }
    }

    if (shouldAutoFallbackProvider) {
      run.pendingStart = startEpisodeNavigation({
        targetResumeSeconds: toHistoryTimestamp(result, effectiveTiming.current, quitThresholdMode),
      });
      const fallback = pickCompatibleFallbackProvider({
        providers: providerRegistry.getCompatible(title, stateManager.getState().mode),
        currentProviderId: resolvedProviderId,
        excludedProviderIds: new Set(stateManager.getState().fallbackTriedProviderIds),
        isFallbackEligible: (providerId) => isProviderIdFallbackEligible(container, providerId),
      });

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
        return NEXT_ITERATION;
      }

      diagnosticsService.record(
        buildRecoveryDiagnosticEvent({
          operation: "playback.provider-fallback.unavailable",
          stage: "fallback-provider",
          status: "failed",
          severity: "blocked",
          failureClass: "not-found",
          message: "Fallback playback control requested but no compatible provider was available",
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
      updatePlaybackFeedback(context, {
        note: "No untried provider left to fall back to. Press o for sources or /diagnostics.",
      });
      // Keep the pending start intent for this episode; re-resolve instead of falling
      // through to auto-advance / post-playback with a poisoned resume offset.
      return NEXT_ITERATION;
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
        const nextPrefetchTarget = buildNextPrefetchTarget();
        if (nextPrefetchTarget) {
          await handoffNextEpisodePrefetch(nextPrefetchTarget, "playback.prefetch-wait");
        }
        return NEXT_ITERATION;
      }
    }

    if (playbackControlAction === "previous" && title.type === "series") {
      if (episodeAvailability.previousEpisode) {
        run.pendingStart = await navigatePlaybackEpisode(episodeAvailability.previousEpisode, {
          cancelPrefetchReason: "user-navigation",
          loadingOrder: "after-start",
          resetStopAfterCurrent: true,
          resumeInterruptedAutoplay: true,
        });
        return NEXT_ITERATION;
      }
    }

    if (playbackControlAction === "pick-episode" && confirmedEpisodeSelection) {
      run.pendingStart = await navigatePlaybackEpisode(confirmedEpisodeSelection, {
        cancelPrefetchReason: "user-navigation",
        loadingOrder: "after-start",
        resetStopAfterCurrent: true,
        resumeInterruptedAutoplay: true,
      });
      return NEXT_ITERATION;
    }

    if (playbackControlAction === "cycle-source") {
      const streams = preparedStream.providerResolveResult?.streams ?? [];
      const resumePos = toHistoryTimestamp(
        result,
        effectiveTiming.current,
        config.quitNearEndThresholdMode,
      );
      if (streams.length > 1) {
        const currentStreamId = preparedStream.providerResolveResult?.selectedStreamId;
        const currentStream = streams.find((s) => s.id === currentStreamId);
        const currentSourceId = currentStream?.sourceId ?? currentStreamId;
        const availableSourceIds = Array.from(
          new Set(
            streams
              .map((s) => s.sourceId)
              .filter((id): id is string => id !== null && id !== undefined && id.length > 0),
          ),
        );

        let nextSelection: StreamSelectionIntent | null = null;
        if (availableSourceIds.length > 1) {
          const currentIndex = availableSourceIds.indexOf(currentSourceId ?? "");
          const nextIndex = (currentIndex + 1) % availableSourceIds.length;
          const nextSourceId = availableSourceIds[nextIndex];
          if (nextSourceId) {
            nextSelection = { sourceId: nextSourceId, streamId: null };
          }
        } else {
          const currentIndex = streams.findIndex((s) => s.id === currentStreamId);
          const nextIndex = (currentIndex + 1) % streams.length;
          const nextStream = streams[nextIndex];
          if (nextStream) {
            nextSelection = {
              sourceId: nextStream.sourceId ?? null,
              streamId: nextStream.id,
            };
          }
        }

        if (nextSelection) {
          run.pendingStart = await applyConfirmedPlaybackTrackSelection(
            "pick-source",
            nextSelection,
            resumePos,
          );
          return NEXT_ITERATION;
        }
      } else {
        run.pendingSourceRefreshAction = "recover";
        run.pendingRecomputeSources = true;
        run.pendingStart = startAtResumePoint(resumePos, { suppressResumePrompt: true });
        return NEXT_ITERATION;
      }
    }

    if (playbackControlAction === "cycle-audio") {
      const streams = preparedStream.providerResolveResult?.streams ?? [];
      const resumePos = toHistoryTimestamp(
        result,
        effectiveTiming.current,
        config.quitNearEndThresholdMode,
      );
      const currentStream = streams.find(
        (s) => s.id === preparedStream.providerResolveResult?.selectedStreamId,
      );
      const currentPresentation =
        currentStream?.presentation ??
        (currentStream?.audioLanguages?.includes("en") ? "dub" : "sub");
      const targetPresentation = currentPresentation === "dub" ? "sub" : "dub";

      const matchingStream = streams.find((s) => {
        if (s.presentation) {
          return s.presentation === targetPresentation;
        }
        if (targetPresentation === "dub") {
          return s.audioLanguages?.includes("en");
        }
        return s.audioLanguages?.includes("ja") || !s.audioLanguages?.includes("en");
      });

      if (matchingStream) {
        const nextSelection: StreamSelectionIntent = {
          sourceId: matchingStream.sourceId ?? null,
          streamId: matchingStream.id,
        };
        run.pendingStart = await applyConfirmedPlaybackTrackSelection(
          "pick-stream",
          nextSelection,
          resumePos,
        );
        return NEXT_ITERATION;
      } else {
        run.pendingSourceRefreshAction = "recover";
        run.pendingStart = startAtResumePoint(resumePos, { suppressResumePrompt: true });
        return NEXT_ITERATION;
      }
    }

    if (playbackControlAction === "pick-source") {
      if (confirmedStreamSelection) {
        run.pendingStart = await applyConfirmedPlaybackTrackSelection(
          playbackControlAction,
          confirmedStreamSelection,
          toHistoryTimestamp(result, effectiveTiming.current, config.quitNearEndThresholdMode),
        );
        return NEXT_ITERATION;
      }
      const picked = await openTracksPanel(preparedStream, { initialSection: "source" }, container);
      const selection = picked ? streamSelectionFromTrackPick(picked) : null;
      if (picked && (selection || picked.section === "subtitle")) {
        const restartResume = toHistoryTimestamp(
          result,
          effectiveTiming.current,
          config.quitNearEndThresholdMode,
        );
        const trackStart = await completeSourceTrackPick(
          currentEpisode,
          picked,
          selection,
          restartResume,
          "playback-control-track-override",
        );
        if (trackStart) {
          run.pendingStart = trackStart;
          if (selection) recordTrackOverrideSelected(picked, selection);
          return NEXT_ITERATION;
        }
      }
    }

    if (playbackControlAction === "pick-stream") {
      if (confirmedStreamSelection) {
        run.pendingStart = await applyConfirmedPlaybackTrackSelection(
          playbackControlAction,
          confirmedStreamSelection,
          toHistoryTimestamp(result, effectiveTiming.current, config.quitNearEndThresholdMode),
        );
        return NEXT_ITERATION;
      }
      const picked = await openTracksPanel(preparedStream, {}, container);
      const selection = picked ? streamSelectionFromTrackPick(picked) : null;
      if (picked && (selection || picked.section === "subtitle")) {
        const restartResume = toHistoryTimestamp(
          result,
          effectiveTiming.current,
          config.quitNearEndThresholdMode,
        );
        const trackStart = await completeSourceTrackPick(
          currentEpisode,
          picked,
          selection,
          restartResume,
          "playback-control-track-override",
        );
        if (trackStart) {
          run.pendingStart = trackStart;
          if (selection) recordTrackOverrideSelected(picked, selection);
          return NEXT_ITERATION;
        }
      }
    }

    if (playbackControlAction === "pick-quality") {
      if (confirmedStreamSelection) {
        run.pendingStart = await applyConfirmedPlaybackTrackSelection(
          playbackControlAction,
          confirmedStreamSelection,
          toHistoryTimestamp(result, effectiveTiming.current, config.quitNearEndThresholdMode),
        );
        return NEXT_ITERATION;
      }
      const picked = await openTracksPanel(
        preparedStream,
        { initialSection: "quality" },
        container,
      );
      const selection = picked ? streamSelectionFromTrackPick(picked) : null;
      if (picked && (selection || picked.section === "subtitle")) {
        const restartResume = toHistoryTimestamp(
          result,
          effectiveTiming.current,
          config.quitNearEndThresholdMode,
        );
        const trackStart = await completeSourceTrackPick(
          currentEpisode,
          picked,
          selection,
          restartResume,
          "playback-control-track-override",
        );
        if (trackStart) {
          run.pendingStart = trackStart;
          if (selection) recordTrackOverrideSelected(picked, selection);
          return NEXT_ITERATION;
        }
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
    // One decision owns one exact queue head. Re-reading after the
    // catalog path would let a reordered row bypass or replace the
    // interrupting play-next intent that prevented episode countdown.
    const autoAdvanceQueueHead = container.queueService.peekNext();
    const { nextEpisode, catalogAutoNext, catalogAutoplayEndBanner, blockedBy } =
      await planCatalogAutoAdvance({
        autoplayAdvanceArgs,
        guards: readAutoAdvanceGuards(),
        queueHead: autoAdvanceQueueHead,
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
      const countdownResult = await host.runAutoNextCountdown(nextEpisodeAdvance);
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
        updatePlaybackFeedback(context, {
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

        updatePlaybackFeedback(context, {
          detail: "Loading next episode",
          note: `S${String(nextEpisodeAdvance.season).padStart(2, "0")}E${String(nextEpisodeAdvance.episode).padStart(2, "0")}`,
        });

        run.pendingStart = await navigatePlaybackEpisode(nextEpisodeAdvance, {
          loadingOrder: "before-start",
          resetStopAfterCurrent: true,
        });

        const autoplayPrefetchTarget = buildPrefetchTarget(nextEpisodeAdvance, resolvedProviderId);
        await handoffNextEpisodePrefetch(
          autoplayPrefetchTarget,
          "post-playback.autonext.prefetch-wait",
        );

        return NEXT_ITERATION;
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
    clearPresenceInBackground(context, "presence.clearPlaybackIdle", "playback-idle");
    preparePostPlaybackSurface(container, episodePrefetch, playbackIterationAbort);
    updatePlaybackFeedback(context, { detail: null, note: null });
    run.playbackSession = transitionPlaybackSession(
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
      hasQueuedNext: Boolean(autoAdvanceQueueHead),
      autoplayRecommendationsEnabled: container.config.autoplayRecommendations,
    });
    const recommendationRailItems = await recommendationRail.resolveRailItems({
      mode: stateManager.getState().mode,
      prefetchedItems: prefetchedRecommendationItems,
      autoContinueIntoRecommendationPossible,
    });
    const topRec = recommendationRailItems[0];
    const topRecommendation: MediaItemIdentity | null = topRec
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
      queueHead: autoAdvanceQueueHead,
      seriesHasNextEpisode: Boolean(episodeAvailability.nextEpisode),
      autoplayRecommendations: container.config.autoplayRecommendations,
      topRecommendation,
    });
    if (playlistAutoNext?.kind === "queue") {
      const nextPlaylistItem = playlistAutoNext.entry;
      const selectedQueueId = nextPlaylistItem.id;
      const autoNextIntent = container.queueService.beginPlayback(selectedQueueId);
      if (autoNextIntent) {
        const nextPlaylistLabel = formatQueueEntryLabel(nextPlaylistItem) ?? nextPlaylistItem.title;
        const playlistCountdown = await runAutoplayAdvanceCountdown({
          seconds: 3,
          signal: context.signal,
          sleep: (ms) => Bun.sleep(ms),
          onTick: (remaining) => {
            updatePlaybackFeedback(context, {
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
      updatePlaybackFeedback(context, { detail: null, note: null });
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
          updatePlaybackFeedback(context, {
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
              externalIds: topRec?.externalIds,
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
      updatePlaybackFeedback(context, { detail: null, note: null });
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
      readWatchedEntries: () => historyRepository.listByTitleIdentity(historyTitleLookup),
      getMode: () => stateManager.getState().mode,
      getAutoplaySessionPaused: () => stateManager.getState().autoplaySessionPaused,
      getAutoskipSessionPaused: () => stateManager.getState().autoskipSessionPaused,
      getProvider: () => stateManager.getState().provider,
      getAnimeSubtitlePreference: () => stateManager.getState().animeLanguageProfile.subtitle,
      getSeriesSubtitlePreference: () => stateManager.getState().seriesLanguageProfile.subtitle,
      dispatchAutoplayPaused: (paused) =>
        stateManager.dispatch({ type: "SET_SESSION_AUTOPLAY_PAUSED", paused }),
      dispatchAutoskipPaused: (paused) =>
        stateManager.dispatch({ type: "SET_SESSION_AUTOSKIP_PAUSED", paused }),
      dispatchStopAfterCurrent: (enabled) =>
        stateManager.dispatch({ type: "SET_SESSION_STOP_AFTER_CURRENT", enabled }),
      dispatchWatchTimeSummary: (summary) =>
        stateManager.dispatch({ type: "SET_WATCH_TIME_SUMMARY", summary }),
      updatePlaybackFeedback: (feedback) => updatePlaybackFeedback(context, feedback),
      transitionPlaybackSession: (session, event, meta) =>
        transitionPlaybackSession(context, session, event, meta ?? {}),
      runAutoNextCountdown: (nextEpisodeTarget) => host.runAutoNextCountdown(nextEpisodeTarget),
      navigatePlaybackEpisode,
      completeSourceTrackPick,
      handoffNextEpisodePrefetch,
      buildPrefetchTarget,
      invalidateRecentEpisodeStream,
      openPlaybackShell,
      chooseEpisodeFromMetadata: async (input) => {
        if (sourceAuthority.kind === "local") {
          const picker = await buildPlaybackEpisodePickerOptions({
            title,
            currentEpisode,
            isAnime: isAnimePlayback,
            networkAllowed: false,
            localEpisodes: listReadyEpisodes(container.offlineAssetService, offlineTitleId),
            watchedEntries: historyRepository.listByTitleIdentity(historyTitleLookup),
          });
          const picked = await openPlaybackEpisodePicker(container, currentEpisode.season, picker);
          return picked && picker.options.some((row) => row.value === picked)
            ? decodeEpisodeSelectionValue(picked)
            : null;
        }
        const { chooseEpisodeFromMetadata } = await import("@/session-flow");
        const outcome = await chooseEpisodeFromMetadata(input);
        // The post-play menu branches on success only, so report the
        // reason here rather than letting a catalog failure read to the
        // user as though they had dismissed the picker themselves.
        if (outcome.kind === "unavailable") {
          stateManager.dispatch({
            type: "SET_PLAYBACK_FEEDBACK",
            note: outcome.reason,
          });
        }
        return outcome.kind === "selected" ? outcome.selection : null;
      },
      episodeInfoFromSelection,
      readAutoAdvanceGuards,
      getCompatibleProviders: () =>
        sourceAuthority.kind === "provider"
          ? providerRegistry.getCompatible(title, stateManager.getState().mode)
          : [],
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
      updatePlaybackFeedback(context, { detail: null, note: null });
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
  // The iteration finished without leaving the phase: run the loop again.
  return NEXT_ITERATION;
}
