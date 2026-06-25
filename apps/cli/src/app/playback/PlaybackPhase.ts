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
import { applyPlaybackEpisodeNavigation } from "@/app/playback/playback-episode-navigation";
import { buildPlaybackEpisodePickerOptions } from "@/app/playback/playback-episode-picker";
import { createPlaybackIteration } from "@/app/playback/playback-iteration";
import type { PlaybackOutcome } from "@/app/playback/playback-outcome";
import { planPlaylistAutoAdvance } from "@/app/playback/playback-playlist-autoadvance";
import {
  createPostPlaybackMenuDeps,
  runPostPlaybackMenuAfterEpisode,
} from "@/app/playback/playback-post-play-entry";
import {
  preparePostPlaybackSurface,
  teardownPlaybackForPostPlayExit,
} from "@/app/playback/playback-post-play-lifecycle";
import { canAutoContinueIntoRecommendation } from "@/app/playback/playback-postplay-policy";
import {
  playbackAudioPreference,
  playbackQualityPreference,
  playbackSubtitlePreference,
} from "@/app/playback/playback-profile-context";
import {
  pickCompatibleFallbackProvider,
  switchPlaybackProviderFallback,
} from "@/app/playback/playback-provider-fallback";
import {
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
import { kitsuneErrorFromUnknown } from "@/domain/kitsune-error-mapping";
import { classifyPersistedKind } from "@/domain/media/content-kind";
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
  describeProviderResolveAttemptDetail,
  describeProviderResolveAttemptNote,
} from "@/domain/playback/provider-resolve-copy";
import type { DecodedTrackSelection } from "@/domain/playback/track-capabilities";
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
} from "@/infra/timing";
import { fetchTitleDetail, peekTitleDetail } from "@/services/catalog/TitleDetailService";
import { PlaybackHistoryLedger } from "@/services/continuation/playback-history-ledger";
import { runBackgroundTask } from "@/services/diagnostics/background-task";
import {
  createCorrelationId,
  type DiagnosticCorrelation,
} from "@/services/diagnostics/correlation";
import { observeResolveNetworkOutcome } from "@/services/network/network-observation";
import {
  createPlaybackStartupTimeline,
  formatPlaybackStartupTimeline,
  formatStartupPhaseBreakdown,
  type PlaybackStartupStage,
  summarizeStartupPhases,
} from "@/services/playback/playback-startup-timeline";
import { enqueueReleaseReconciliation } from "@/services/release-reconciliation/enqueue-release-reconciliation";
import { mergeSubtitleTracks, resolveSubtitlesByTmdbId, selectSubtitle } from "@/subtitle";
import { fetchEpisodes, fetchSeasons } from "@/tmdb";
import type { ResolveAttempt } from "@kunai/core";

// Re-exported for tests that import it from this module's public surface.
export type { PlaybackOutcome } from "@/app/playback/playback-outcome";
export { playbackStartupStageForPlayerEvent };

const timingAggregator = new PlaybackTimingAggregator([IntroDbTimingSource, AniSkipTimingSource]);

export class PlaybackPhase implements Phase<TitleInfo, PlaybackOutcome> {
  name = "playback";

  private static readonly lateSubtitleInflight = new Set<string>();
  private playbackLedger: PlaybackHistoryLedger | null = null;

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

    try {
      // Episode selection (for series)
      let episode: EpisodeInfo | undefined;
      // One-shot shared start position from a share link (kunai://...&t=). Consumed once
      // here; the series path applies it via the resolver, the movie path inline below.
      // A title is either movie or series, so the two paths never double-apply it.
      const bootstrapStartSeconds = consumeShareBootstrapStartSeconds();
      const resolveTargetResumeSeconds = createBootstrapResumeResolver({
        sharedStartSeconds: bootstrapStartSeconds,
        resumeFromHistory: (target: EpisodeInfo) =>
          resumeSecondsFromHistoryForEpisode(
            historyRepository,
            title.id,
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

      if (title.type === "series") {
        // Check history for resume
        const history =
          historyRepository.getLatestForTitleIdentity({
            id: title.id,
            kind: stateManager.getState().mode === "anime" || title.isAnime ? "anime" : "series",
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
        const isAnimeMode = stateManager.getState().mode === "anime";
        const seasonCount = isAnimeMode
          ? (title.episodeCount ?? initialAnimeEpisodes?.length)
          : ((await fetchSeasons(title.id).catch(() => null))?.length ?? undefined);
        const episodeEntry = resolvePlaybackEpisodeEntry({
          titleId: title.id,
          titleType: title.type,
          isAnime: isAnimeMode,
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
            isAnime: stateManager.getState().mode === "anime",
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
            isAnime: stateManager.getState().mode === "anime",
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
            isAnime: stateManager.getState().mode === "anime",
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
            kind: "movie",
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
        }
        const queuedSourceOverride = playerControl.consumePendingEpisodeSourceOverride();
        if (queuedSourceOverride) {
          run.episodePlaybackSourceOverride = queuedSourceOverride;
          invalidateRecentEpisodeStream(currentEpisode);
        }
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
        const abortOnSessionStop = () => resolveController.abort();
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
            resolveController.abort();
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

          // Warm the catalog-detail cache early (fire-and-forget) so the post-play
          // rail can read it synchronously instead of racing a cold fetch. Errors
          // are swallowed; post-play falls back to honest placeholders if it never
          // resolves, and the next open reads it warm.
          void fetchTitleDetail(title.id, title.type).catch(() => undefined);

          // Kick off timing fetch in parallel with everything else — IntroDB is a
          // lightweight API call and should resolve well before stream resolution.
          recordStartupMark("timing-fetch-started");
          const timingFetch = this.getPlaybackTimingMetadata(
            title,
            currentEpisode,
            playbackTimingByEpisode,
            resolveController.signal,
            stateManager.getState().mode === "anime",
            currentProvider?.metadata.id,
          );

          const watchedEntries = historyRepository.listByTitle(title.id);
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
          const shellEpisodePickerPromise = currentAnimeEpisodesPromise.then(
            (currentAnimeEpisodes) =>
              buildPlaybackEpisodePickerOptions({
                title,
                currentEpisode,
                isAnime: isAnimePlayback,
                animeEpisodeCount: title.episodeCount,
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
                animeEpisodeCount: title.episodeCount,
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
            note: "Esc cancels this resolve and returns to results",
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
            logger.info("Using prefetched stream for episode", {
              titleId: title.id,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
              prepared: prefetchWasPrepared,
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
                onFeedback: (feedback) => this.updatePlaybackFeedback(context, feedback),
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

            if (resolvedProviderId !== currentProvider.metadata.id) {
              logger.info("Resolved stream with fallback provider", {
                from: currentProvider.metadata.id,
                fallback: resolvedProviderId,
              });
              run.sessionSoftProviderId = resolvedProviderId;
              const fallbackName =
                providerRegistry.get(resolvedProviderId)?.metadata.name ?? resolvedProviderId;
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

          stream = applyPreferredStreamSelection(
            stream,
            getPreferredStreamSelection(currentProvider.metadata.id, currentEpisode),
          );

          // Await timing — stream resolve takes much longer so this is nearly free.
          // If IntroDB timed out and returned null, schedule a background retry that
          // injects timing into the running player once it arrives.
          recordStartupMark("timing-wait-started", stream);
          const fetchedPlaybackTiming = run.localEpisodeTiming ?? (await timingFetch);
          run.localEpisodeTiming = null;
          recordStartupMark("timing-ready", stream);
          const playbackTiming = mergeTimingMetadata(
            fetchedPlaybackTiming,
            extractProviderNativeTiming(stream, title),
          );
          if (playbackTiming) {
            const timingCacheKey =
              title.type === "movie"
                ? `movie:${title.id}`
                : `series:${title.id}:${currentEpisode.season}:${currentEpisode.episode}`;
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
                providerId: container.stateManager.getState().provider,
              },
              run: () =>
                this.retryTimingInBackground(
                  title,
                  currentEpisode,
                  container,
                  effectiveTiming,
                  playbackTimingByEpisode,
                  stateManager.getState().mode === "anime",
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
            const prefetchMetadata = providerRegistry.get(
              run.sessionSoftProviderId ?? stateManager.getState().provider,
            );
            if (!prefetchMetadata) return null;
            return buildPrefetchTarget(nextEp, prefetchMetadata.metadata.id);
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
            const prefetchMetadata = providerRegistry.get(
              run.sessionSoftProviderId ?? stateManager.getState().provider,
            );
            if (nextEp && prefetchMetadata) {
              await selectionCoordinator.hydrate(prefetchMetadata.metadata.id, nextEp);
            }
            const target = buildNextPrefetchTarget();
            if (!target) return;
            nextPrefetchProgress = {};
            episodePrefetch.schedule(target, (signal) => runNextEpisodePrefetch(signal, target));

            if (
              container.config.recommendationRailEnabled &&
              prefetchedRecommendationItems === null
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
            await container.player.releasePersistentSession();
            return { status: "cancelled" };
          }

          let result: PlaybackResult;
          try {
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
              playbackIterationAbort.signal,
            );
          } catch (error) {
            if (error instanceof PlaybackAbortedError || context.signal.aborted) {
              stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
              await container.player.releasePersistentSession();
              return { status: "cancelled" };
            }
            throw error;
          }

          if (context.signal.aborted) {
            stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
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
            const historyTimestamp = toHistoryTimestamp(
              result,
              effectiveTiming.current,
              quitThresholdMode,
            );
            const didComplete = didPlaybackReachCompletionThreshold(
              result,
              effectiveTiming.current,
              quitThresholdMode,
            );
            const persistedKind = classifyPersistedKind(title, stateManager.getState().mode, {
              providerId: resolvedProviderId,
            });
            const historyTitleId = resolveTitleHistoryLookupId(title, stateManager.getState().mode);
            if (this.playbackLedger) {
              this.playbackLedger.finalize({
                positionSeconds: historyTimestamp,
                durationSeconds: result.duration,
                completed: didComplete,
                providerId: resolvedProviderId,
                posterUrl: title.posterUrl,
              });
              this.playbackLedger = null;
            } else {
              container.historyRepository.upsertProgress({
                title: {
                  id: title.id,
                  kind: persistedKind,
                  title: title.name,
                  externalIds: title.externalIds,
                },
                episode: {
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                },
                positionSeconds: historyTimestamp,
                durationSeconds: result.duration,
                completed: didComplete,
                watchedSeconds: didComplete ? result.duration : historyTimestamp,
                lastWatchedAt: new Date().toISOString(),
                completedAt: didComplete ? new Date().toISOString() : null,
                providerId: resolvedProviderId,
                posterUrl: title.posterUrl,
                updatedAt: new Date().toISOString(),
              });
            }
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
            const invalidateProviderId = consumedBundle
              ? (consumedBundle.target.providerId ?? resolvedProviderId)
              : resolvedProviderId;
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
          if (playbackDecision.shouldTreatAsInterrupted) {
            stateManager.dispatch({
              type: "SET_SESSION_AUTOPLAY_PAUSED",
              paused: playbackDecision.session.autoplayPaused,
            });
          }
          if (playbackDecision.shouldRefreshSource) {
            const isExplicitSourceRefresh =
              playbackControlAction === "refresh" || playbackControlAction === "recover";
            const isAutoSourceRecover =
              !isExplicitSourceRefresh &&
              (result.suspectedDeadStream === true || didPlaybackFailToStart(result));

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
            } else {
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
              diagnosticsService.record({
                category: "playback",
                message:
                  run.pendingSourceRefreshAction === "recover"
                    ? "Recovery requested for current provider source"
                    : "Refresh requested for current provider source",
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
              });
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

          if (playbackDecision.shouldFallbackProvider) {
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
              diagnosticsService.record({
                category: "playback",
                message: "Switching to fallback provider after playback control request",
                context: {
                  from: switched.fromProviderId,
                  fallback: switched.providerId,
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  resumeSeconds: run.pendingStart.resumePromptAt,
                },
              });
              continue;
            }

            diagnosticsService.record({
              category: "playback",
              message:
                "Fallback playback control requested but no compatible provider was available",
              context: {
                provider: resolvedProviderId,
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
              },
            });
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
              stateManager.dispatch({ type: "SET_SESSION_AUTOPLAY_PAUSED", paused: true });
              run.playbackSession = {
                ...run.playbackSession,
                autoplayPaused: true,
                autoplayPauseReason: "user",
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
            budgetMs: 250,
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
            const episodeLabel =
              nextPlaylistItem.episode !== undefined
                ? ` S${String(nextPlaylistItem.season ?? 1).padStart(2, "0")}E${String(nextPlaylistItem.episode).padStart(2, "0")}`
                : "";
            const playlistCountdown = await runAutoplayAdvanceCountdown({
              seconds: 3,
              signal: context.signal,
              sleep: (ms) => Bun.sleep(ms),
              onTick: (remaining) => {
                this.updatePlaybackFeedback(context, {
                  detail: "Playlist next ready",
                  note: `Next: ${nextPlaylistItem.title}${episodeLabel} in ${remaining}s  ·  a to pause`,
                });
              },
              isCancelled: () => stateManager.getState().autoplaySessionPaused,
            });
            if (playlistCountdown !== "cancelled") {
              container.queueService.advance();
              const titleInfo: TitleInfo = {
                id: nextPlaylistItem.titleId,
                name: nextPlaylistItem.title,
                type: nextPlaylistItem.mediaKind === "movie" ? "movie" : "series",
              };
              return {
                status: "success",
                value: {
                  type: "playlist-advance",
                  titleInfo,
                  mode: nextPlaylistItem.mediaKind === "anime" ? "anime" : "series",
                  season: nextPlaylistItem.season,
                  episode: nextPlaylistItem.episode,
                },
              };
            }
            stateManager.dispatch({ type: "SET_SESSION_AUTOPLAY_PAUSED", paused: true });
            run.playbackSession = {
              ...run.playbackSession,
              autoplayPaused: true,
              autoplayPauseReason: "user",
            };
            this.updatePlaybackFeedback(context, { detail: null, note: null });
          } else if (playlistAutoNext?.kind === "recommendation") {
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
                  },
                  mode: stateManager.getState().mode,
                },
              };
            }
            stateManager.dispatch({ type: "SET_SESSION_AUTOPLAY_PAUSED", paused: true });
            run.playbackSession = {
              ...run.playbackSession,
              autoplayPaused: true,
              autoplayPauseReason: "user",
            };
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
  ): Promise<void> {
    return (async () => {
      const mode = isAnime ? "anime" : title.type === "movie" ? "movie" : "series";
      const providerId = container.stateManager.getState().provider;
      const timing = await timingAggregator.resolve(
        title,
        episode,
        mode,
        AbortSignal.timeout(10_000),
        { providerId },
      );
      if (timing) {
        if (timingRef) timingRef.current = timing;
        if (cache) {
          const cacheKey =
            title.type === "movie"
              ? `movie:${title.id}`
              : `series:${title.id}:${episode.season}:${episode.episode}`;
          cache.set(cacheKey, timing);
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
  ) {
    const cacheKey =
      title.type === "movie"
        ? `movie:${title.id}`
        : `series:${title.id}:${episode.season}:${episode.episode}`;

    if (cache.has(cacheKey)) {
      return cache.get(cacheKey) ?? null;
    }

    const mode = isAnime ? "anime" : title.type === "movie" ? "movie" : "series";
    const timing = await timingAggregator.resolve(title, episode, mode, signal, { providerId });
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

    if (isInteractiveSubtitle) {
      return { target, stream, prepared: false };
    }

    const preparedStream = await this.preparePlaybackStream(
      stream,
      input.title,
      input.nextEpisode,
      context,
    );

    return { target, stream: preparedStream, prepared: true };
  }

  private async preparePlaybackStream(
    stream: StreamInfo,
    title: TitleInfo,
    episode: EpisodeInfo,
    context: PhaseContext,
  ): Promise<StreamInfo> {
    const { stateManager, logger } = context.container;
    const subLang =
      stateManager.getState().mode === "anime"
        ? stateManager.getState().animeLanguageProfile.subtitle
        : stateManager.getState().seriesLanguageProfile.subtitle;

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
    playbackIterationSignal?: AbortSignal,
  ): Promise<PlaybackResult> {
    const { player, stateManager, config, historyRepository, playbackEventRepository } =
      context.container;

    const subtitleStatus = describePlaybackSubtitleStatus(
      stream,
      stateManager.getState().mode === "anime"
        ? stateManager.getState().animeLanguageProfile.subtitle
        : stateManager.getState().seriesLanguageProfile.subtitle,
    );

    this.startLateSubtitleResolver({
      stream,
      title,
      episode,
      context,
      playbackIterationSignal,
    });

    const presenceBase = () => ({
      mode: stateManager.getState().mode,
      title,
      episode,
      providerId: stateManager.getState().provider,
      stream,
      startedAtMs: Date.now(),
    });

    const persistedKind = classifyPersistedKind(title, stateManager.getState().mode, {
      providerId: stateManager.getState().provider,
    });
    this.playbackLedger = new PlaybackHistoryLedger(historyRepository, playbackEventRepository);
    this.playbackLedger.start(
      {
        title: {
          id: title.id,
          kind: persistedKind,
          title: title.name,
          externalIds: title.externalIds,
        },
        episode:
          title.type === "series"
            ? { season: episode.season, episode: episode.episode }
            : undefined,
        providerId: stateManager.getState().provider,
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
        providerId: stateManager.getState().provider,
      },
      playOptions: {
        abortSignal: context.signal,
        audioPreference:
          stateManager.getState().mode === "anime"
            ? stateManager.getState().animeLanguageProfile.audio
            : title.type === "movie"
              ? stateManager.getState().movieLanguageProfile.audio
              : stateManager.getState().seriesLanguageProfile.audio,
        subtitlePreference:
          stateManager.getState().mode === "anime"
            ? stateManager.getState().animeLanguageProfile.subtitle
            : title.type === "movie"
              ? stateManager.getState().movieLanguageProfile.subtitle
              : stateManager.getState().seriesLanguageProfile.subtitle,
        qualityPreference:
          stateManager.getState().mode === "anime"
            ? stateManager.getState().animeLanguageProfile.quality
            : title.type === "movie"
              ? stateManager.getState().movieLanguageProfile.quality
              : stateManager.getState().seriesLanguageProfile.quality,
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
    const requestedSubLang =
      stateManager.getState().mode === "anime"
        ? stateManager.getState().animeLanguageProfile.subtitle
        : stateManager.getState().seriesLanguageProfile.subtitle;
    const lookupDecision = shouldAttemptLateSubtitleLookup({
      stream,
      requestedSubLang,
      hasTitleId: Boolean(title.id),
    });
    if (!lookupDecision.attempt) {
      if (
        lookupDecision.reason !== "disabled" &&
        lookupDecision.reason !== "attached" &&
        lookupDecision.reason !== "hardsub-satisfied"
      ) {
        diagnosticsService.record({
          category: "subtitle",
          message: "Late subtitle lookup skipped",
          context: {
            titleId: title.id,
            requestedSubLang,
            reason: lookupDecision.reason,
            availableTracks: lookupDecision.availableTracks,
          },
        });
      }
      return;
    }

    const inflightKey = `${title.id}:${episode.season}:${episode.episode}:${requestedSubLang}`;
    if (PlaybackPhase.lateSubtitleInflight.has(inflightKey)) {
      diagnosticsService.record({
        category: "subtitle",
        message: "Late subtitle lookup skipped (already in flight)",
        context: { inflightKey },
      });
      return;
    }
    PlaybackPhase.lateSubtitleInflight.add(inflightKey);

    diagnosticsService.record({
      category: "subtitle",
      message: "Late subtitle lookup started",
      context: {
        titleId: title.id,
        type: title.type,
        season: episode.season,
        episode: episode.episode,
        requestedSubLang,
      },
    });

    void (async () => {
      try {
        const result = await resolveSubtitlesByTmdbId({
          tmdbId: title.id,
          type: title.type,
          season: title.type === "series" ? episode.season : undefined,
          episode: title.type === "series" ? episode.episode : undefined,
          preferredLang: requestedSubLang,
        });

        if (iterationSignal.aborted) return;
        if (result.list.length === 0) {
          diagnosticsService.record({
            category: "subtitle",
            message: result.failed ? "Late subtitle lookup failed" : "Late subtitle lookup empty",
            context: {
              titleId: title.id,
              requestedSubLang,
              failed: result.failed,
            },
          });
          return;
        }

        const mergedSubtitleList = mergeSubtitleTracks(
          stream.subtitleList,
          result.list as unknown as SubtitleTrack[],
        );
        const selected = selectSubtitle(mergedSubtitleList as never, requestedSubLang);
        const selectedUrl = selected?.url ?? result.selected ?? null;
        if (!selectedUrl) {
          diagnosticsService.record({
            category: "subtitle",
            message: "Late subtitle lookup found tracks but no selectable URL",
            context: { titleId: title.id, trackCount: mergedSubtitleList.length },
          });
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

        diagnosticsService.record({
          category: "subtitle",
          operation: "subtitle.attach.outcome",
          message: "Late subtitle lookup attached tracks",
          context: {
            titleId: title.id,
            outcome: "attached",
            delivery: "late",
            trackCount: mergedSubtitleList.length,
          },
        });
      } catch (error) {
        if (iterationSignal.aborted) return;
        logger.warn("Late subtitle lookup failed", { error: String(error) });
        diagnosticsService.record({
          category: "subtitle",
          message: "Late subtitle lookup failed",
          context: { titleId: title.id, error: String(error) },
        });
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
    context.container.diagnosticsService.record({
      category: "subtitle",
      operation: "subtitle.attach.outcome",
      message: "Late subtitle attachment timed out waiting for player",
      context: {
        outcome: "player-ready-timeout",
        delivery: "late",
        trackCount: attachment.subtitleTracks.length,
      },
    });
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
    mode: "series" | "anime";
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
    if (cacheKey) {
      cache.set(cacheKey, result);
    }
    return result;
  }

  private async loadAnimeEpisodeOptions(
    title: TitleInfo,
    mode: "series" | "anime",
    provider: import("../../services/providers/Provider").Provider | undefined,
    signal?: AbortSignal,
  ): Promise<readonly EpisodePickerOption[] | undefined> {
    if (mode !== "anime" || title.type !== "series" || !provider?.listEpisodes) {
      return undefined;
    }

    try {
      return (await provider.listEpisodes({ title }, signal)) ?? undefined;
    } catch {
      return undefined;
    }
  }
}
