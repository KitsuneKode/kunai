// =============================================================================
// Playback Phase
//
// Handles episode selection → stream resolve → MPV playback → post-playback.
// Returns when user wants to go back to search or switch mode.
// =============================================================================

import { routePlaybackShellAction } from "@/app-shell/command-router";
import { resolveCommandContext } from "@/app-shell/commands";
import { capturePlaybackShellError } from "@/app-shell/playback-shell-error-capture";
import {
  openTracksPanel,
  buildPickerActionContext,
  openSubtitlePicker,
  handleShellAction,
  enqueueCurrentPlaybackDownload,
} from "@/app-shell/workflows";
import { runAutoplayAdvanceCountdown } from "@/app/autoplay-advance-countdown";
import { episodeInfoFromSelection } from "@/app/episode-info-from-catalog";
import { resolveLocalEpisodePlayback } from "@/app/episode-playback-source";
import {
  adoptEpisodePrefetchBundle,
  EpisodePrefetchHandle,
  isEpisodePrefetchEligible,
  type EpisodePrefetchBundle,
  type EpisodePrefetchProgress,
  type EpisodePrefetchTarget,
} from "@/app/episode-prefetch";
import {
  dismissMpvTransitionOverlay,
  MAX_AUTO_SOURCE_RECOVER_ATTEMPTS,
  releasePersistentMpvForTerminalFailure,
  shouldReleasePersistentMpvBeforePostPlay,
} from "@/app/mpv-session-lifecycle";
import type { Phase, PhaseResult, PhaseContext } from "@/app/Phase";
import {
  createDeadStreamUrlLedger,
  playbackDeadStreamScopeKey,
} from "@/app/playback-dead-stream-ledger";
import {
  applyPlaybackEpisodeNavigation,
  buildEpisodeNavigationTransitionContext,
} from "@/app/playback-episode-navigation";
import { buildPlaybackEpisodePickerOptions } from "@/app/playback-episode-picker";
import {
  preparePostPlaybackSurface,
  teardownPlaybackForPostPlayExit,
} from "@/app/playback-post-play-lifecycle";
import {
  canAutoContinueIntoRecommendation,
  canResumePlayback as resolveCanResumePlayback,
  isNearEndVoluntaryQuit,
} from "@/app/playback-postplay-policy";
import {
  playbackAudioPreference,
  playbackQualityPreference,
  playbackSubtitlePreference,
} from "@/app/playback-profile-context";
import {
  pickCompatibleFallbackProvider,
  switchPlaybackProviderFallback,
} from "@/app/playback-provider-fallback";
import {
  resolveStreamProviderId,
  resolveTitleProviderPreference,
} from "@/app/playback-provider-switch";
import {
  enqueuePostPlaybackRecommendation,
  openPostPlaybackRecommendationActionPanel,
  recommendationRailItemToSearchResult,
} from "@/app/playback-recommendation-actions";
import { resolvePlaybackResolvePolicy } from "@/app/playback-resolve-policy";
import { resumeSecondsFromHistoryForEpisode } from "@/app/playback-resume-from-history";
import { PlaybackSelectionCoordinator } from "@/app/playback-selection-coordinator";
import {
  createPlaybackSessionState,
  explainAutoplayBlockReason,
  explainAutoplayNoNextEpisodeCatalogHint,
  resolveAutoplayAdvanceEpisode,
  didPlaybackFailToStart,
  resolvePlaybackResultDecision,
  resolvePostPlaybackSessionAction,
  syncPlaybackSessionState,
  transitionPlaybackSessionPhase,
  type PlaybackSessionPhaseEvent,
  type PlaybackSessionState,
} from "@/app/playback-session-controller";
import { invalidateEpisodePlaybackCaches } from "@/app/playback-source-cache-invalidation";
import {
  startAtResumePoint,
  startEpisodeNavigation,
  startFromBeginning,
  startFromEpisodeSelection,
} from "@/app/playback-start-intent";
import {
  formatPlaybackStreamRoute,
  playbackStartupStageForPlayerEvent,
  summarizeStartupStreamSource,
} from "@/app/playback-startup-format";
import {
  applyPlaybackControlTrackSelection,
  buildTrackOverrideDiagnosticContext,
} from "@/app/playback-track-selection-policy";
import {
  buildPostPlayEpisodeLabel,
  buildPostPlayInputFromPlaybackContext,
  buildPostPlayNextEpisodeLabel,
  buildPostPlayQueueNextLabel,
} from "@/app/post-play-input";
import {
  loadPostPlaybackRecommendationItems,
  type PostPlaybackRecommendationItem,
  resolvePostPlaybackRecommendationLoadMode,
  seedPostPlaybackRecommendationItems,
} from "@/app/post-playback-recommendations";
import {
  resolvePostPlaybackEpisodeNavigationRoute,
  resolvePostPlaybackExitOutcome,
  resolvePostPlaybackTrackPanelSection,
} from "@/app/post-playback-routing";
import {
  recentPlaybackStreamKey,
  recentPlaybackStreamMatchesProvider,
  type RecentPlaybackStreamProvenance,
  type RecentPlaybackStreamRecord,
} from "@/app/recent-playback-stream";
import { createResolveTraceStub } from "@/app/resolve-trace";
import {
  applyPreferredStreamSelection,
  streamSelectionFromTrackPick,
  type StreamSelectionIntent,
} from "@/app/source-quality";
import {
  createSourceRefreshCooldownState,
  resolveSourceRefreshDecision,
  type SourceRefreshAction,
} from "@/app/source-refresh-policy";
import { choosePlaybackSubtitle, shouldAttemptLateSubtitleLookup } from "@/app/subtitle-selection";
import { describePlaybackSubtitleStatus } from "@/app/subtitle-status";
import { titleInfoFromSearchResult } from "@/app/title-info";
import { resolveTitleHistoryLookupId } from "@/app/title-info";
import { applyTrackPickRestart } from "@/app/track-pick-restart";
import { buildTrackPickTransitionContext } from "@/app/tracks-panel-pick";
import { episodeThumbKey } from "@/domain/catalog/title-detail";
import { classifyPersistedKind } from "@/domain/media/content-kind";
import { shouldPersistHistory, toHistoryTimestamp } from "@/domain/playback/playback-history";
import {
  didPlaybackEndNearNaturalEnd,
  didPlaybackReachCompletionThreshold,
  resolveEpisodeAvailability,
  toEpisodeNavigationState,
} from "@/domain/playback/playback-policy";
import {
  buildPlayerFailureProblem,
  buildProviderResolveProblem,
  type PlaybackProblem,
} from "@/domain/playback/playback-problem";
import { resolvePostPlayState } from "@/domain/playback/post-play-state";
import {
  describeProviderResolveAttemptDetail,
  describeProviderResolveAttemptNote,
} from "@/domain/playback/provider-resolve-copy";
import type { DecodedTrackSelection } from "@/domain/playback/track-capabilities";
import { aggregateWatchTime, formatWatchTimeSummary } from "@/domain/playback/watch-time-stats";
import type {
  TitleInfo,
  EpisodeInfo,
  EpisodePickerOption,
  PlaybackTimingMetadata,
  ShellMode,
  StreamInfo,
  PlaybackResult,
  SubtitleTrack,
  SearchResult,
} from "@/domain/types";
import { PlaybackAbortedError } from "@/infra/player/playback-aborted";
import {
  classifyPlaybackFailureFromEvent,
  classifyPlaybackFailureFromResult,
  recoveryForPlaybackFailure,
} from "@/infra/player/playback-failure-classifier";
import type { ActivePlayerControl } from "@/infra/player/PlayerControlService";
import type { PlayerPlaybackEvent } from "@/infra/player/PlayerService";
import {
  AniSkipTimingSource,
  extractProviderNativeTiming,
  IntroDbTimingSource,
  mergeTimingMetadata,
  PlaybackTimingAggregator,
} from "@/infra/timing";
import { fetchTitleDetail, peekTitleDetail } from "@/services/catalog/TitleDetailService";
import { formatTimestamp } from "@/services/continuation/history-progress";
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
export { playbackStartupStageForPlayerEvent };

const timingAggregator = new PlaybackTimingAggregator([IntroDbTimingSource, AniSkipTimingSource]);

async function applyMpvEpisodeLoadingOverlay(
  control: ActivePlayerControl | null,
  episode: EpisodeInfo,
) {
  if (!control) return;
  const label = `Kunai · Loading S${String(episode.season).padStart(2, "0")}E${String(episode.episode).padStart(2, "0")}…`;
  if (control.setEpisodeTransitionLoading) {
    await control.setEpisodeTransitionLoading(label);
  } else {
    await control.showOsdMessage?.(label, 120_000);
  }
}

async function applyMpvStreamSwitchOverlay(
  control: ActivePlayerControl | null,
  detail = "Switching source…",
) {
  if (!control) return;
  const label = `Kunai · ${detail}`;
  if (control.setEpisodeTransitionLoading) {
    await control.setEpisodeTransitionLoading(label);
  } else {
    await control.showOsdMessage?.(label, 120_000);
  }
}

export type PlaybackOutcome =
  | "back_to_search"
  | "back_to_results"
  | "back_to_history"
  | "mode_switch"
  | "quit"
  | { type: "browse_route"; route: "calendar" | "random" }
  | { type: "history_entry"; title: TitleInfo; episode?: EpisodeInfo }
  | {
      type: "playlist-advance";
      titleInfo: TitleInfo;
      mode: ShellMode;
      season?: number;
      episode?: number;
    };

export class PlaybackPhase implements Phase<TitleInfo, PlaybackOutcome> {
  name = "playback";

  private static readonly lateSubtitleInflight = new Set<string>();

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
        stateManager.dispatch({ type: "SET_AUTO_NEXT_COUNTDOWN", seconds: remaining });
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

    // Countdown is over (advanced, cancelled, or skipped) — clear the live value so
    // the post-play hero stops showing a stale "Playing in Ns".
    stateManager.dispatch({ type: "SET_AUTO_NEXT_COUNTDOWN", seconds: null });

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
    switch (event.type) {
      case "media-materialized":
        return {
          detail:
            event.kind === "dash-mpd"
              ? "Preparing DASH media"
              : event.kind === "hls-manifest"
                ? "Preparing HLS playlist for mpv"
                : "Preparing media",
        };
      case "launching-player":
        return { detail: "Launching player" };
      case "mpv-process-started":
        return { detail: "mpv launched" };
      case "ipc-connected":
        return { detail: "Player control connected" };
      case "ipc-command-failed":
        return {
          note: `Player command failed: ${event.command} (${event.error})`,
        };
      case "ipc-stalled":
        return {
          detail: "Player control stalled",
          note: `mpv did not answer ${event.command}; playback may still be alive`,
        };
      case "opening-stream":
        return { detail: "Opening provider stream" };
      case "resolving-playback":
        return { detail: "Resolving playback" };
      case "network-buffering": {
        const cacheAhead =
          typeof event.cacheAheadSeconds === "number"
            ? `${event.cacheAheadSeconds.toFixed(1)}s cached ahead`
            : null;
        const percent = typeof event.percent === "number" ? `${Math.round(event.percent)}%` : null;
        const status = [percent, cacheAhead].filter(Boolean).join(" / ") || "Filling demuxer cache";
        return {
          detail: "Building playback buffer",
          note: `${status}`,
        };
      }
      case "network-sample":
        return {};
      case "stream-slow":
        return {
          detail:
            event.state === "slow-network-suspected"
              ? "Slow source (network read)"
              : "Building playback buffer",
          note: `${event.secondsBuffering}s buffering`,
        };
      case "subtitle-inventory-ready":
        return {
          detail: "Attaching subtitles",
          note:
            event.trackCount > 0
              ? `${event.trackCount} alternate subtitle tracks are ready in mpv`
              : "Primary subtitle is ready",
        };
      case "subtitle-attached":
        return {
          note:
            event.trackCount > 0
              ? `${event.trackCount} subtitle tracks attached`
              : "Primary subtitle attached",
        };
      case "late-subtitles-attached":
        return {
          note: `${event.trackCount} late subtitle ${event.trackCount === 1 ? "track" : "tracks"} attached`,
        };
      case "player-ready":
        return { detail: "Player controls ready" };
      case "playback-started":
        return { detail: "Playing" };
      case "stream-stalled": {
        const dead = event.stallKind === "network-read-dead";
        return {
          detail: dead ? "Stream stalled (network read idle)" : "Stream stalled",
          note: `${dead ? "Demuxer underrun with no incoming bytes" : `No playback progress for ${event.secondsWithoutProgress}s`} · ${recoveryForPlaybackFailure(classifyPlaybackFailureFromEvent(event)).label}`,
        };
      }
      case "seek-stalled":
        return {
          detail: "Seek stalled",
          note: `mpv has been seeking for ${event.secondsSeeking}s · ${recoveryForPlaybackFailure(classifyPlaybackFailureFromEvent(event)).label}`,
        };
      case "player-closing":
        return { detail: "Closing player" };
      case "player-closed":
        return { detail: "Player closed" };
      case "segment-skipped":
        return {
          note: `${event.kind.charAt(0).toUpperCase()}${event.kind.slice(1)} ${event.automatic ? "skipped automatically" : "skipped"}`,
        };
      case "track-changed":
        return {
          note: `${event.trackType === "audio" ? "Audio" : "Subtitle"} track switched in mpv (id ${event.id})`,
        };
      case "mpv-in-process-reconnect": {
        const phaseLabel =
          event.phase === "started"
            ? "Reloading same stream in mpv"
            : event.phase === "complete"
              ? "Reload finished"
              : "Reload failed";
        return {
          detail: phaseLabel,
          note: event.detail
            ? `Attempt ${event.attempt} · ${event.detail}`
            : `Attempt ${event.attempt}`,
        };
      }
    }
    return {};
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
    let playbackSession: PlaybackSessionState = createPlaybackSessionState({
      autoNextEnabled: config.autoNext,
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
    let sessionSoftProviderId: string | null = null;
    const sourceRefreshCooldown = createSourceRefreshCooldownState();
    let pendingSourceRefreshAction: SourceRefreshAction | null = null;
    let pendingRecomputeSources = false;
    let episodePlaybackSourceOverride: "local" | "online" | null = null;
    let localEpisodeTiming: PlaybackTimingMetadata | null = null;

    try {
      // Episode selection (for series)
      let episode: EpisodeInfo | undefined;
      let pendingStart = startFromBeginning();
      const startNavigationToEpisode = async (target: EpisodeInfo) =>
        startEpisodeNavigation({
          targetResumeSeconds: resumeSecondsFromHistoryForEpisode(
            historyRepository,
            title.id,
            target,
            config.quitNearEndThresholdMode,
          ),
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
          session: playbackSession,
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
        playbackSession = result.session;
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
          await import("@/app/playback-provider-switch");
        applyTitleProviderPreferenceToSession(
          container,
          title.id,
          title,
          stateManager.getState().mode,
        );
        providerSwitchSeqBeforeEpisodePicker = stateManager.getState().providerSwitchSeq;

        // Session-flow owns the current season/episode selection rules until the
        // mounted root shell fully absorbs the picker stack.
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
        pendingStart =
          selection.startAt !== undefined || selection.suppressResumePrompt
            ? startFromEpisodeSelection(selection)
            : await startNavigationToEpisode(episode);
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
        pendingStart = startFromEpisodeSelection(selection);
      }

      stateManager.dispatch({ type: "SELECT_EPISODE", episode });
      playbackSession = this.transitionPlaybackSession(
        context,
        playbackSession,
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
      let autoSourceRecoverAttempts = 0;
      let autoRecoverEpisodeKey: string | null = null;
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
        pendingSourceRefreshAction = "recover";
        invalidateRecentEpisodeStream(targetEpisode);
        this.updatePlaybackFeedback(context, {
          detail: "Switching stream…",
          note: "Re-resolving with your selection",
        });
        await applyMpvStreamSwitchOverlay(playerControl.getActive());
      };

      // Inner playback loop
      while (true) {
        if (context.signal.aborted) {
          stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
          await container.player.releasePersistentSession();
          return { status: "cancelled" };
        }

        const playbackIterationAbort = new AbortController();
        const currentEpisode = stateManager.getState().currentEpisode;
        if (!currentEpisode) break;
        const episodeScopeKey = `${title.id}:${currentEpisode.season}:${currentEpisode.episode}`;
        if (autoRecoverEpisodeKey !== episodeScopeKey) {
          autoRecoverEpisodeKey = episodeScopeKey;
          autoSourceRecoverAttempts = 0;
        }
        const queuedSourceOverride = playerControl.consumePendingEpisodeSourceOverride();
        if (queuedSourceOverride) {
          episodePlaybackSourceOverride = queuedSourceOverride;
          invalidateRecentEpisodeStream(currentEpisode);
        }
        playbackSession = this.transitionPlaybackSession(
          context,
          playbackSession,
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
          if (sessionSoftProviderId && sessionSoftProviderId !== configuredProviderId) {
            sessionSoftProviderId = null;
          }
          const currentProvider = providerRegistry.get(
            sessionSoftProviderId ?? configuredProviderId,
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
            const { resolveTracksPanelPick } = await import("@/app/tracks-panel-pick");
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
              pendingSourceRefreshAction = "recover";
              pendingRecomputeSources = false;
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

          const sourceRefreshAction = pendingSourceRefreshAction;
          pendingSourceRefreshAction = null;
          const recomputeSources = pendingRecomputeSources;
          pendingRecomputeSources = false;
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
            sessionSoftProviderId = null;
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
                forceOnline: episodePlaybackSourceOverride === "online",
                forceLocal: episodePlaybackSourceOverride === "local",
              },
            );
            episodePlaybackSourceOverride = null;
            if (localResolution) {
              stream = localResolution.stream;
              streamProvenance = "local";
              localEpisodeTiming = localResolution.timing;
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
              sessionSoftProviderId = resolvedProviderId;
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
            if (resolveController.signal.aborted && !context.signal.aborted) {
              const streamSwitchAction = playerControl.consumeLastAction();
              const streamSwitchSelection =
                streamSwitchAction === "pick-source" ||
                streamSwitchAction === "pick-stream" ||
                streamSwitchAction === "pick-quality"
                  ? playerControl.consumePendingStreamSelection()
                  : null;
              if (streamSwitchSelection) {
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
              if (resolveAbortIntent === "fallback") {
                const fallback = providerRegistry
                  .getCompatible(title, stateManager.getState().mode)
                  .find((candidate) => candidate.metadata.id !== currentProvider.metadata.id);
                if (fallback) {
                  sessionSoftProviderId = null;
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
              stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "idle" });
              stateManager.dispatch({ type: "SET_STREAM", stream: null });
              this.updatePlaybackFeedback(context, { detail: null, note: null });
              await dismissMpvTransitionOverlay(playerControl);
              return { status: "success", value: "back_to_results" };
            }
            const problem = buildProviderResolveProblem({
              attempts: resolveAttempts,
              capabilitySnapshot: container.capabilitySnapshot,
            });
            playbackSession = this.transitionPlaybackSession(
              context,
              playbackSession,
              "failure-shown",
              {
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
                cause: problem.cause,
              },
            );
            const problemAction = await this.showPlaybackProblem(context, problem);
            if (problemAction === "retry") {
              pendingSourceRefreshAction = "recover";
              pendingRecomputeSources = true;
              autoSourceRecoverAttempts = 0;
              invalidateRecentEpisodeStream(currentEpisode);
              this.updatePlaybackFeedback(context, {
                detail: "Retrying with fresh provider sources…",
                note: "Cached failures and stale source inventory are bypassed for this attempt.",
              });
              continue;
            }
            stateManager.dispatch({ type: "SET_STREAM", stream: null });
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
          const fetchedPlaybackTiming = localEpisodeTiming ?? (await timingFetch);
          localEpisodeTiming = null;
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
          playbackSession = this.transitionPlaybackSession(
            context,
            playbackSession,
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
          const startIntent = pendingStart;
          pendingStart = startFromBeginning();

          let prefetchedRecommendationItems: readonly SearchResult[] | null = null;
          let nextPrefetchProgress: EpisodePrefetchProgress = {};
          const buildNextPrefetchTarget = (): EpisodePrefetchTarget | null => {
            const nextEp = episodeAvailability.nextEpisode;
            if (!nextEp) return null;
            const prefetchMetadata = providerRegistry.get(
              sessionSoftProviderId ?? stateManager.getState().provider,
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
                stopAfterCurrent: playbackSession.stopAfterCurrent,
                sessionMode: playbackSession.mode,
                autoplayPaused: playbackSession.autoplayPaused,
              })
            ) {
              return;
            }
            const nextEp = episodeAvailability.nextEpisode;
            const prefetchMetadata = providerRegistry.get(
              sessionSoftProviderId ?? stateManager.getState().provider,
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

          playbackSession = this.transitionPlaybackSession(
            context,
            playbackSession,
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
              playbackSession.mode,
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
          playbackSession = this.transitionPlaybackSession(
            context,
            playbackSession,
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
              providerId: resolvedProviderId,
              // Persist the poster so resume/continue rebuilds the title WITH art
              // (no poster on resumed playback was just a missing URL) + history rail.
              posterUrl: title.posterUrl,
              updatedAt: new Date().toISOString(),
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
          playbackSession = syncPlaybackSessionState(playbackSession, {
            autoplaySessionPaused: stateManager.getState().autoplaySessionPaused,
            stopAfterCurrent: stateManager.getState().stopAfterCurrent,
          });
          const playbackDecision = resolvePlaybackResultDecision({
            result,
            controlAction: playbackControlAction,
            session: playbackSession,
            timing: effectiveTiming.current,
            endPolicy: {
              quitNearEndBehavior: config.quitNearEndBehavior,
              quitNearEndThresholdMode: config.quitNearEndThresholdMode,
            },
          });
          playbackSession = playbackDecision.session;
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
              autoSourceRecoverAttempts >= MAX_AUTO_SOURCE_RECOVER_ATTEMPTS
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
              pendingRecomputeSources = playbackControlAction === "recompute";
              pendingStart = startAtResumePoint(
                toHistoryTimestamp(result, effectiveTiming.current, quitThresholdMode),
                { suppressResumePrompt: true },
              );
              pendingSourceRefreshAction =
                playbackControlAction === "recompute"
                  ? "recover"
                  : result.suspectedDeadStream === true ||
                      didPlaybackFailToStart(result) ||
                      playbackControlAction === "recover"
                    ? "recover"
                    : "refresh";
              if (isAutoSourceRecover) {
                autoSourceRecoverAttempts += 1;
              }
              diagnosticsService.record({
                category: "playback",
                message:
                  pendingSourceRefreshAction === "recover"
                    ? "Recovery requested for current provider source"
                    : "Refresh requested for current provider source",
                context: {
                  provider: resolvedProviderId,
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  resumeSeconds: pendingStart.startAt,
                  action: pendingSourceRefreshAction,
                  recomputeSources: pendingRecomputeSources,
                  autoRecover: isAutoSourceRecover,
                  autoRecoverAttempts: autoSourceRecoverAttempts,
                },
              });
              playbackSession = this.transitionPlaybackSession(
                context,
                playbackSession,
                "recovery-started",
                {
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  provider: resolvedProviderId,
                  action: pendingSourceRefreshAction,
                },
              );
              continue;
            }
          }

          if (playbackDecision.shouldFallbackProvider) {
            pendingStart = startEpisodeNavigation({
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
              sessionSoftProviderId = null;
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
              pendingSourceRefreshAction = "recover";
              pendingRecomputeSources = false;
              diagnosticsService.record({
                category: "playback",
                message: "Switching to fallback provider after playback control request",
                context: {
                  from: switched.fromProviderId,
                  fallback: switched.providerId,
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  resumeSeconds: pendingStart.resumePromptAt,
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
              pendingStart = await navigatePlaybackEpisode(episodeAvailability.nextEpisode, {
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
              pendingStart = await navigatePlaybackEpisode(episodeAvailability.previousEpisode, {
                cancelPrefetchReason: "user-navigation",
                loadingOrder: "after-start",
                resetStopAfterCurrent: true,
                resumeInterruptedAutoplay: true,
              });
              continue;
            }
          }

          if (playbackControlAction === "pick-episode" && confirmedEpisodeSelection) {
            pendingStart = await navigatePlaybackEpisode(confirmedEpisodeSelection, {
              cancelPrefetchReason: "user-navigation",
              loadingOrder: "after-start",
              resetStopAfterCurrent: true,
              resumeInterruptedAutoplay: true,
            });
            continue;
          }

          if (playbackControlAction === "pick-source") {
            if (confirmedStreamSelection) {
              pendingStart = await applyConfirmedPlaybackTrackSelection(
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
              pendingStart = await completeSourceTrackPick(
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
              pendingStart = await applyConfirmedPlaybackTrackSelection(
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
              pendingStart = await completeSourceTrackPick(
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
              pendingStart = await applyConfirmedPlaybackTrackSelection(
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
              pendingStart = await completeSourceTrackPick(
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
              sessionMode: playbackSession.mode,
              autoplayPaused: playbackSession.autoplayPaused,
              stopAfterCurrent: playbackSession.stopAfterCurrent,
              hasNextEpisode: Boolean(episodeAvailability.nextEpisode),
              upcomingNext: episodeAvailability.upcomingNext,
              animeNextReleaseUnknown: episodeAvailability.animeNextReleaseUnknown,
            },
          });
          const autoplayAdvanceArgs = {
            result,
            title,
            currentEpisode,
            session: playbackSession,
            availability: episodeAvailability,
            timing: effectiveTiming.current,
            endPolicy: {
              quitNearEndBehavior: config.quitNearEndBehavior,
              quitNearEndThresholdMode: config.quitNearEndThresholdMode,
            },
          };
          const nextEpisode = await resolveAutoplayAdvanceEpisode(autoplayAdvanceArgs);
          let catalogAutoplayEndBanner: string | undefined;
          if (!nextEpisode) {
            const blockedBy = explainAutoplayBlockReason(autoplayAdvanceArgs);
            catalogAutoplayEndBanner = explainAutoplayNoNextEpisodeCatalogHint({
              ...autoplayAdvanceArgs,
              isAnime: stateManager.getState().mode === "anime",
            });

            // Enrich the anime banner with precise schedule data from cache when available.
            // Overrides the generic "release schedules not shown here" message with a real date.
            if (stateManager.getState().mode === "anime" && title.id.startsWith("anilist:")) {
              const schedule = container.catalogScheduleService.peekNextRelease(
                "anilist",
                title.id,
              );
              if (schedule?.episode && schedule.releaseAt) {
                const nextEp = schedule.episode;
                const releaseMs = Date.parse(schedule.releaseAt);
                const nowMs2 = Date.now();
                if (Number.isFinite(releaseMs) && releaseMs > nowMs2) {
                  const diffMs = releaseMs - nowMs2;
                  const diffH = diffMs / 3_600_000;
                  let timeLabel: string;
                  if (diffH < 24) {
                    const h = Math.floor(diffH);
                    const m = Math.floor((diffH - h) * 60);
                    timeLabel = h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
                  } else if (diffH < 168) {
                    timeLabel = `on ${new Date(releaseMs).toLocaleDateString(undefined, { weekday: "long" })}`;
                  } else {
                    timeLabel = new Date(releaseMs).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    });
                  }
                  catalogAutoplayEndBanner = `Caught up · Ep ${nextEp} airs ${timeLabel}`;
                }
              }
            }

            diagnosticsService.record({
              category: "playback",
              message: "Auto-next blocked",
              context: {
                blockedBy,
                endReason: result.endReason,
                watchedSeconds: result.watchedSeconds,
                duration: result.duration,
                autoplayMode: playbackSession.mode,
                autoplayPaused: playbackSession.autoplayPaused,
                stopAfterCurrent: playbackSession.stopAfterCurrent,
                hasNextEpisode: Boolean(episodeAvailability.nextEpisode),
                upcomingNext: episodeAvailability.upcomingNext,
                animeNextReleaseUnknown: episodeAvailability.animeNextReleaseUnknown,
                catalogBanner: catalogAutoplayEndBanner ?? null,
              },
            });
          }
          if (nextEpisode) {
            const countdownResult = await this.runAutoNextCountdown(context, nextEpisode);
            if (countdownResult === "cancelled") {
              stateManager.dispatch({ type: "SET_SESSION_AUTOPLAY_PAUSED", paused: true });
              playbackSession = {
                ...playbackSession,
                autoplayPaused: true,
                autoplayPauseReason: "user",
              };
              diagnosticsService.record({
                category: "playback",
                message: "Auto-next countdown cancelled",
                context: {
                  titleId: title.id,
                  nextSeason: nextEpisode.season,
                  nextEpisode: nextEpisode.episode,
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
                nextSeason: nextEpisode.season,
                nextEpisode: nextEpisode.episode,
                hasPrefetch: episodePrefetch.hasReadyFor(
                  buildPrefetchTarget(nextEpisode, resolvedProviderId),
                ),
              });
              diagnosticsService.record({
                category: "playback",
                message: "Auto-next advancing to next episode",
                context: {
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  nextSeason: nextEpisode.season,
                  nextEpisode: nextEpisode.episode,
                  hasPrefetch: episodePrefetch.hasReadyFor(
                    buildPrefetchTarget(nextEpisode, resolvedProviderId),
                  ),
                },
              });

              this.updatePlaybackFeedback(context, {
                detail: "Loading next episode",
                note: `S${String(nextEpisode.season).padStart(2, "0")}E${String(nextEpisode.episode).padStart(2, "0")}`,
              });

              pendingStart = await navigatePlaybackEpisode(nextEpisode, {
                loadingOrder: "before-start",
                resetStopAfterCurrent: true,
              });

              const autoplayPrefetchTarget = buildPrefetchTarget(nextEpisode, resolvedProviderId);
              await handoffNextEpisodePrefetch(
                autoplayPrefetchTarget,
                "post-playback.autonext.prefetch-wait",
              );

              continue;
            }
          }

          if (playbackSession.stopAfterCurrent) {
            stateManager.dispatch({ type: "SET_SESSION_STOP_AFTER_CURRENT", enabled: false });
            playbackSession = {
              ...playbackSession,
              stopAfterCurrent: false,
            };
          }

          await player.releasePersistentSession();
          this.clearPresenceInBackground(context, "presence.clearPlaybackIdle", "playback-idle");
          preparePostPlaybackSurface(container, episodePrefetch, playbackIterationAbort);
          this.updatePlaybackFeedback(context, { detail: null, note: null });
          playbackSession = this.transitionPlaybackSession(
            context,
            playbackSession,
            "post-playback-opened",
            {
              titleId: title.id,
              season: currentEpisode.season,
              episode: currentEpisode.episode,
              endReason: result.endReason,
            },
          );

          // Playlist auto-advance: if catalog autoplay didn't fire, check the
          // user's Up Next queue for a cross-title advance.
          if (
            !nextEpisode &&
            result.endReason === "eof" &&
            !playbackSession.autoplayPaused &&
            !context.signal.aborted
          ) {
            const nextPlaylistItem = container.queueService.peekNext();
            if (nextPlaylistItem) {
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
              playbackSession = {
                ...playbackSession,
                autoplayPaused: true,
                autoplayPauseReason: "user",
              };
              this.updatePlaybackFeedback(context, { detail: null, note: null });
            }
          }

          // Post-playback menu — inner loop so unavailable navigation
          // actions stay in the menu instead of re-resolving the stream.
          const { openPlaybackShell } = await import("../app-shell/ink-shell");

          // Loaded once per post-play session when the synchronous seed is empty.
          // null = not yet attempted; [] = attempted (within budget) but empty.
          let postPlaybackLoadedRecommendations: readonly PostPlaybackRecommendationItem[] | null =
            null;
          // Guards a single background recommendation load (menu rail only) so we
          // never block first paint and never re-trigger while one is in flight.
          let postPlaybackRecommendationLoadInFlight = false;
          let postPlayProviderId = stateManager.getState().provider;
          let openRecoverySourcePanelOnPostPlay =
            (result.suspectedDeadStream === true || didPlaybackFailToStart(result)) &&
            Boolean(preparedStream.providerResolveResult?.streams.length);
          // Keep first paint snappy. Prefetched recommendations still show
          // immediately; live discovery is a nice-to-have rail and should never
          // make episode completion feel stuck.
          const POST_PLAYBACK_RECOMMENDATION_BUDGET_MS = 250;

          postPlayback: while (true) {
            const resumeSeconds = toHistoryTimestamp(
              result,
              effectiveTiming.current,
              config.quitNearEndThresholdMode,
            );
            const nearEndVoluntaryQuit = isNearEndVoluntaryQuit({
              endReason: result.endReason,
              quitNearEndBehavior: config.quitNearEndBehavior,
              sessionMode: playbackSession.mode,
              autoplayPaused: playbackSession.autoplayPaused,
              stopAfterCurrent: playbackSession.stopAfterCurrent,
              hasNextEpisode: Boolean(episodeAvailability.nextEpisode),
              endedNearNaturalEnd: didPlaybackEndNearNaturalEnd(
                result,
                effectiveTiming.current,
                config.quitNearEndThresholdMode,
              ),
            });
            if (nearEndVoluntaryQuit && episodeAvailability.nextEpisode) {
              const postPlayNextEpisode = episodeAvailability.nextEpisode;
              const countdownResult = await this.runAutoNextCountdown(context, postPlayNextEpisode);
              if (countdownResult !== "cancelled" && !context.signal.aborted) {
                logger.info("Post-play auto-next advancing after near-end quit", {
                  titleId: title.id,
                  nextSeason: postPlayNextEpisode.season,
                  nextEpisode: postPlayNextEpisode.episode,
                });
                pendingStart = await navigatePlaybackEpisode(postPlayNextEpisode, {
                  resetStopAfterCurrent: true,
                });
                const autoplayPrefetchTarget = buildPrefetchTarget(
                  postPlayNextEpisode,
                  resolvedProviderId,
                );
                await handoffNextEpisodePrefetch(
                  autoplayPrefetchTarget,
                  "post-playback.autonext.prefetch-wait",
                );
                break postPlayback;
              }
              if (countdownResult === "cancelled") {
                stateManager.dispatch({ type: "SET_SESSION_AUTOPLAY_PAUSED", paused: true });
                playbackSession = {
                  ...playbackSession,
                  autoplayPaused: true,
                  autoplayPauseReason: "user",
                };
              }
            }
            const autoplaySessionPaused = playbackSession.autoplayPaused;
            const nearNaturalEpisodeEnd = didPlaybackEndNearNaturalEnd(
              result,
              effectiveTiming.current,
              config.quitNearEndThresholdMode,
            );
            const canResumePlayback = resolveCanResumePlayback({
              resumeSeconds,
              durationSeconds: result.duration,
              endReason: result.endReason,
              endedNearNaturalEnd: nearNaturalEpisodeEnd,
            });
            if (openRecoverySourcePanelOnPostPlay) {
              openRecoverySourcePanelOnPostPlay = false;
              const picked = await openTracksPanel(
                preparedStream,
                {
                  initialSection: "source",
                  failedCurrentReason: result.suspectedDeadStream
                    ? "Playback failed on this stream."
                    : "Playback did not start on this stream.",
                },
                container,
              );
              const selection = picked ? streamSelectionFromTrackPick(picked) : null;
              if (picked && selection) {
                pendingStart = await completeSourceTrackPick(
                  currentEpisode,
                  picked,
                  selection,
                  resumeSeconds,
                  "post-playback-tracks",
                );
                playbackSession = this.transitionPlaybackSession(
                  context,
                  playbackSession,
                  "recovery-started",
                  {
                    titleId: title.id,
                    season: currentEpisode.season,
                    episode: currentEpisode.episode,
                    provider: resolvedProviderId,
                    action: "recover",
                  },
                );
                break postPlayback;
              }
            }
            const mode = stateManager.getState().mode;
            const recommendationRailStartedAtMs = Date.now();
            let recommendationRailItems = seedPostPlaybackRecommendationItems({
              enabled: container.config.recommendationRailEnabled,
              currentTitle: title.name,
              prefetchedItems: prefetchedRecommendationItems,
            });
            diagnosticsService.record({
              category: "playback",
              operation: "post-playback.recommendations.seed",
              message: "Post-playback recommendations seeded for first paint",
              context: {
                titleId: title.id,
                mode,
                itemCount: recommendationRailItems.length,
                elapsedMs: Date.now() - recommendationRailStartedAtMs,
                prefetched: Boolean(
                  (prefetchedRecommendationItems as readonly SearchResult[] | null)?.length,
                ),
              },
            });
            // The seed (prefetched items) paints instantly. When it is empty
            // (e.g. starting from history), only BLOCK for a live load if we might
            // auto-continue into the top recommendation; otherwise load it in the
            // BACKGROUND so the menu paints immediately and the rail fills on a
            // later loop iteration. This removes the from-history post-play lag.
            const autoContinueIntoRecommendationPossible = canAutoContinueIntoRecommendation({
              hasNextEpisode: Boolean(nextEpisode),
              endReason: result.endReason,
              autoplayPaused: playbackSession.autoplayPaused,
              autoplaySessionPaused: stateManager.getState().autoplaySessionPaused,
              aborted: context.signal.aborted,
              hasQueuedNext: Boolean(container.queueService.peekNext()),
              autoplayRecommendationsEnabled: container.config.autoplayRecommendations,
            });
            const recommendationLoadMode = resolvePostPlaybackRecommendationLoadMode({
              seedCount: recommendationRailItems.length,
              railEnabled: container.config.recommendationRailEnabled,
              alreadyAttempted: postPlaybackLoadedRecommendations !== null,
              autoContinueIntoRecommendationPossible,
            });
            if (recommendationLoadMode === "block") {
              const loadStartedAtMs = Date.now();
              let recommendationLoadTimedOut = false;
              postPlaybackLoadedRecommendations = await Promise.race([
                loadPostPlaybackRecommendationItems(container, title, mode, null),
                Bun.sleep(POST_PLAYBACK_RECOMMENDATION_BUDGET_MS).then(() => {
                  recommendationLoadTimedOut = true;
                  return [] as readonly PostPlaybackRecommendationItem[];
                }),
              ]).catch(() => [] as readonly PostPlaybackRecommendationItem[]);
              diagnosticsService.record({
                category: "playback",
                operation: "post-playback.recommendations.load",
                message: "Post-playback recommendations loaded before auto-continue decision",
                context: {
                  titleId: title.id,
                  mode,
                  itemCount: postPlaybackLoadedRecommendations.length,
                  elapsedMs: Date.now() - loadStartedAtMs,
                  timedOut: recommendationLoadTimedOut,
                },
              });
            } else if (
              recommendationLoadMode === "background" &&
              !postPlaybackRecommendationLoadInFlight
            ) {
              postPlaybackRecommendationLoadInFlight = true;
              const loadStartedAtMs = Date.now();
              void loadPostPlaybackRecommendationItems(container, title, mode, null)
                .catch(() => [] as readonly PostPlaybackRecommendationItem[])
                .then((items) => {
                  postPlaybackLoadedRecommendations = items;
                  diagnosticsService.record({
                    category: "playback",
                    operation: "post-playback.recommendations.background",
                    message: "Post-playback recommendations loaded in the background",
                    context: {
                      titleId: title.id,
                      mode,
                      itemCount: items.length,
                      elapsedMs: Date.now() - loadStartedAtMs,
                    },
                  });
                  return items;
                });
            }
            if (postPlaybackLoadedRecommendations && postPlaybackLoadedRecommendations.length > 0) {
              recommendationRailItems = postPlaybackLoadedRecommendations;
            }
            // YouTube-style continuous play: a natural finish with no next episode and
            // an empty queue auto-continues into the top recommendation — same cancelable
            // countdown as the episode/queue advance, gated by autoplayRecommendations.
            // See resolveNextUp + the Up Next spec. (Episode + queue advance are handled
            // earlier; this is the rec tail of the same spine.)
            const topRec = recommendationRailItems[0];
            if (
              !nextEpisode &&
              result.endReason === "eof" &&
              !playbackSession.autoplayPaused &&
              !stateManager.getState().autoplaySessionPaused &&
              !context.signal.aborted &&
              !container.queueService.peekNext() &&
              container.config.autoplayRecommendations &&
              topRec
            ) {
              const recCountdown = await runAutoplayAdvanceCountdown({
                seconds: 5,
                signal: context.signal,
                sleep: (ms) => Bun.sleep(ms),
                onTick: (remaining) =>
                  this.updatePlaybackFeedback(context, {
                    detail: "Up next ready",
                    note: `Up next: ${topRec.title} in ${remaining}s  ·  a to pause`,
                  }),
                isCancelled: () => stateManager.getState().autoplaySessionPaused,
              });
              if (recCountdown !== "cancelled") {
                return {
                  status: "success",
                  value: {
                    type: "playlist-advance",
                    titleInfo: {
                      id: topRec.id,
                      name: topRec.title,
                      type: topRec.type,
                      posterUrl: topRec.posterPath ?? undefined,
                    },
                    mode,
                  },
                };
              }
              this.updatePlaybackFeedback(context, { detail: null, note: null });
            }
            // Playback "started" means mpv reached real content. Exit on load or a
            // quit within the first seconds (no eof, no resumable position, almost
            // nothing watched) is NOT a completion — never claim finished/watched.
            const playbackStarted =
              result.endReason === "eof" || result.watchedSeconds >= 30 || resumeSeconds > 10;
            const postPlayInput = buildPostPlayInputFromPlaybackContext({
              title,
              currentEpisode,
              availability: episodeAvailability,
              isAnime: mode === "anime",
              nextAirDateHint: catalogAutoplayEndBanner?.replace(/^Caught up ·\s*/i, ""),
              playbackStarted,
            });
            const postPlayState = resolvePostPlayState(postPlayInput);
            // Personal watch-time stat for the series-complete celebration, gated by
            // config. Aggregates this title's history; null hides the line.
            const watchTimeSummary =
              postPlayState.kind === "series-complete" && container.config.showWatchTimeStats
                ? formatWatchTimeSummary(
                    aggregateWatchTime(historyRepository.listByTitle(title.id)),
                  )
                : null;
            stateManager.dispatch({ type: "SET_WATCH_TIME_SUMMARY", summary: watchTimeSummary });
            const upcomingEpisode = episodeAvailability.nextEpisode;
            const nextEpisodePickerOption = upcomingEpisode
              ? shellEpisodePicker.options.find(
                  (option) =>
                    option.value === `${upcomingEpisode.season}:${upcomingEpisode.episode}`,
                )
              : undefined;
            const episodesInCurrentSeason = shellEpisodePicker.options.filter((option) =>
              option.value.startsWith(`${currentEpisode.season}:`),
            ).length;
            const watchedEpisodes = watchedEntries.filter((entry) =>
              title.type === "series" ? entry.season === currentEpisode.season : true,
            ).length;
            // Catalog detail for the post-play rail. Read synchronously from the
            // cache the episode-start prefetch warmed — never blocks the surface.
            // Undefined falls back to honest placeholders; the next open is warm.
            const postPlayTitleDetail = peekTitleDetail(title.id, title.type);
            // Next-episode still for the post-play rail, when the merged artwork
            // carries one for that exact season/episode.
            const nextEpisodeThumbUrl =
              upcomingEpisode && postPlayTitleDetail?.artwork?.episodeThumbnails
                ? postPlayTitleDetail.artwork.episodeThumbnails[
                    episodeThumbKey(upcomingEpisode.season, upcomingEpisode.episode)
                  ]
                : undefined;
            const postAction = await openPlaybackShell({
              container,
              state: {
                type: title.type,
                title: title.name,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
                posterUrl: title.posterUrl,
                titleDetail: postPlayTitleDetail,
                provider: resolvedProviderId,
                subtitleStatus: describeSubtitleStatus(
                  preparedStream,
                  stateManager.getState().mode === "anime"
                    ? stateManager.getState().animeLanguageProfile.subtitle
                    : stateManager.getState().seriesLanguageProfile.subtitle,
                ),
                autoplayPaused: autoplaySessionPaused,
                autoskipPaused: stateManager.getState().autoskipSessionPaused,
                stopAfterCurrent: playbackSession.stopAfterCurrent,
                showMemory: false,
                mode,
                resumeLabel: canResumePlayback
                  ? title.type === "series"
                    ? `resume S${String(currentEpisode.season).padStart(2, "0")}E${String(currentEpisode.episode).padStart(2, "0")}  ·  ${formatTimestamp(resumeSeconds)}`
                    : `resume ${formatTimestamp(resumeSeconds)}`
                  : undefined,
                status: catalogAutoplayEndBanner
                  ? { label: catalogAutoplayEndBanner, tone: "neutral" }
                  : { label: "Ready for next action", tone: "success" },
                footerMode: "minimal",
                postPlayState,
                episodeLabel: buildPostPlayEpisodeLabel(
                  title,
                  currentEpisode,
                  episodesInCurrentSeason || undefined,
                ),
                nextEpisodeLabel: buildPostPlayNextEpisodeLabel(
                  upcomingEpisode,
                  nextEpisodePickerOption?.label,
                ),
                queueNextLabel: buildPostPlayQueueNextLabel(container.queueService.peekNext()),
                nextEpisodeThumbUrl,
                totalEpisodes: title.episodeCount ?? shellEpisodePicker.options.length,
                watchedEpisodes,
                currentSeason: currentEpisode.season,
                recommendationRailItems: recommendationRailItems.slice(0, 4).map((item) => ({
                  id: item.id,
                  title: item.title,
                  type: item.type,
                  ...(item.sourceId ? { sourceId: item.sourceId } : {}),
                  ...(item.titleAliases ? { titleAliases: item.titleAliases } : {}),
                  ...(item.year ? { year: item.year } : {}),
                  ...(item.overview ? { overview: item.overview } : {}),
                  ...(item.posterPath !== undefined ? { posterPath: item.posterPath } : {}),
                  ...(item.episodeCount ? { episodeCount: item.episodeCount } : {}),
                })),
                commands: resolveCommandContext(stateManager.getState(), "postPlayback"),
              },
            });

            if (typeof postAction === "object") {
              if (postAction.type === "track-selection") {
                const picked = postAction.pick;
                const selection = streamSelectionFromTrackPick(picked);
                if (!selection) {
                  continue postPlayback;
                }
                const fromProviderId = resolvedProviderId;
                pendingStart = await completeSourceTrackPick(
                  currentEpisode,
                  picked,
                  selection,
                  resumeSeconds,
                  "post-playback-tracks",
                );
                playbackSession = this.transitionPlaybackSession(
                  context,
                  playbackSession,
                  "episode-navigation",
                  buildTrackPickTransitionContext({
                    titleId: title.id,
                    episode: currentEpisode,
                    selection,
                    fromProviderId,
                  }),
                );
                break postPlayback;
              }
              if (postAction.type === "play-recommendation") {
                await teardownPlaybackForPostPlayExit(
                  container,
                  episodePrefetch,
                  playbackIterationAbort,
                );
                return {
                  status: "success",
                  value: {
                    type: "history_entry",
                    title: titleInfoFromSearchResult(
                      recommendationRailItemToSearchResult(postAction.item),
                    ),
                  },
                };
              }
              if (postAction.type === "queue-recommendation") {
                await enqueuePostPlaybackRecommendation(container, postAction.item);
              } else if (postAction.type === "open-recommendation-actions") {
                await openPostPlaybackRecommendationActionPanel({
                  container,
                  items: postAction.items,
                  mode,
                });
              }
              continue postPlayback;
            }

            const routedAction = await routePlaybackShellAction({
              action: postAction,
              container,
            });

            const exitOutcome = resolvePostPlaybackExitOutcome(routedAction);
            if (exitOutcome) {
              await teardownPlaybackForPostPlayExit(
                container,
                episodePrefetch,
                playbackIterationAbort,
              );
              return exitOutcome;
            } else if (routedAction === "toggle-autoplay") {
              const playbackAction = resolvePostPlaybackSessionAction(
                "toggle-autoplay",
                playbackSession,
              );
              playbackSession = playbackAction.session;
              stateManager.dispatch({
                type: "SET_SESSION_AUTOPLAY_PAUSED",
                paused: playbackAction.session.autoplayPaused,
              });
              continue postPlayback;
            } else if (routedAction === "toggle-autoskip") {
              stateManager.dispatch({
                type: "SET_SESSION_AUTOSKIP_PAUSED",
                paused: !stateManager.getState().autoskipSessionPaused,
              });
              continue postPlayback;
            } else if (routedAction === "stop-after-current") {
              const enabled = !playbackSession.stopAfterCurrent;
              stateManager.dispatch({
                type: "SET_SESSION_STOP_AFTER_CURRENT",
                enabled,
              });
              playbackSession = {
                ...playbackSession,
                stopAfterCurrent: enabled,
              };
              continue postPlayback;
            } else {
              const navigationRoute = resolvePostPlaybackEpisodeNavigationRoute({
                action: routedAction,
                titleType: title.type,
                availability: episodeAvailability,
              });
              if (navigationRoute) {
                pendingStart = await navigatePlaybackEpisode(navigationRoute.episode);
                playbackSession = this.transitionPlaybackSession(
                  context,
                  playbackSession,
                  "episode-navigation",
                  buildEpisodeNavigationTransitionContext({
                    titleId: title.id,
                    episode: navigationRoute.episode,
                    source: navigationRoute.source,
                  }),
                );
                break postPlayback;
              }
              if (
                routedAction === "next" ||
                routedAction === "previous" ||
                routedAction === "next-season"
              ) {
                continue postPlayback;
              }
            }

            const trackPanelSection = resolvePostPlaybackTrackPanelSection(routedAction);

            if (routedAction === "resume") {
              pendingStart = startAtResumePoint(resumeSeconds, { suppressResumePrompt: true });
              const playbackAction = resolvePostPlaybackSessionAction("resume", playbackSession);
              playbackSession = playbackAction.session;
              playbackSession = this.transitionPlaybackSession(
                context,
                playbackSession,
                "resume-requested",
                {
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  resumeSeconds,
                },
              );
              if (!playbackAction.session.autoplayPaused) {
                stateManager.dispatch({ type: "SET_SESSION_AUTOPLAY_PAUSED", paused: false });
              }
              break postPlayback;
            } else if (routedAction === "replay") {
              pendingStart = startFromBeginning();
              if (postPlayState.kind === "did-not-start") {
                pendingSourceRefreshAction = "recover";
                autoSourceRecoverAttempts = 0;
                invalidateRecentEpisodeStream(currentEpisode);
              }
              const playbackAction = resolvePostPlaybackSessionAction("replay", playbackSession);
              playbackSession = playbackAction.session;
              playbackSession = this.transitionPlaybackSession(
                context,
                playbackSession,
                "replay-requested",
                {
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                },
              );
              if (!playbackAction.session.autoplayPaused) {
                stateManager.dispatch({ type: "SET_SESSION_AUTOPLAY_PAUSED", paused: false });
              }
              break postPlayback;
            } else if (routedAction === "recompute") {
              pendingStart = startEpisodeNavigation({ targetResumeSeconds: resumeSeconds });
              pendingSourceRefreshAction = "recover";
              pendingRecomputeSources = true;
              autoSourceRecoverAttempts = 0;
              invalidateRecentEpisodeStream(currentEpisode);
              playbackSession = this.transitionPlaybackSession(
                context,
                playbackSession,
                "recovery-started",
                {
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  provider: resolvedProviderId,
                  action: "recompute",
                },
              );
              diagnosticsService.record({
                category: "playback",
                message: "Recomputing provider sources after shell command",
                context: {
                  provider: resolvedProviderId,
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  resumeSeconds,
                },
              });
              break postPlayback;
            } else if (routedAction === "fallback") {
              const fallback = pickCompatibleFallbackProvider(
                providerRegistry.getCompatible(title, stateManager.getState().mode),
                resolvedProviderId,
              );
              if (!fallback) {
                continue postPlayback;
              }
              sessionSoftProviderId = null;
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
              postPlayProviderId = switched.providerId;
              pendingSourceRefreshAction = "recover";
              pendingRecomputeSources = false;
              pendingStart = startEpisodeNavigation({ targetResumeSeconds: resumeSeconds });
              playbackSession = this.transitionPlaybackSession(
                context,
                playbackSession,
                "episode-navigation",
                {
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  fromProvider: switched.fromProviderId,
                  provider: switched.providerId,
                },
              );
              diagnosticsService.record({
                category: "playback",
                message: "Switching to fallback provider after shell command",
                context: {
                  from: switched.fromProviderId,
                  fallback: switched.providerId,
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                  resumeSeconds,
                },
              });
              break postPlayback;
            } else if (trackPanelSection) {
              // Unified Tracks panel: each command deep-links its section. The
              // user may switch any section from the same panel, so restart
              // semantics follow the picked section, not the opening command.
              const picked = await openTracksPanel(
                preparedStream,
                { initialSection: trackPanelSection },
                container,
              );
              if (!picked) {
                continue postPlayback;
              }
              const selection = streamSelectionFromTrackPick(picked);
              if (!selection && picked.section !== "subtitle") {
                continue postPlayback;
              }
              const fromProviderId = resolvedProviderId;
              pendingStart = await completeSourceTrackPick(
                currentEpisode,
                picked,
                selection,
                resumeSeconds,
                "post-playback-tracks",
              );
              playbackSession = this.transitionPlaybackSession(
                context,
                playbackSession,
                "episode-navigation",
                selection
                  ? buildTrackPickTransitionContext({
                      titleId: title.id,
                      episode: currentEpisode,
                      selection,
                      fromProviderId,
                    })
                  : {
                      titleId: title.id,
                      season: currentEpisode.season,
                      episode: currentEpisode.episode,
                    },
              );
              break postPlayback;
            } else if (routedAction === "download") {
              await enqueueCurrentPlaybackDownload({
                container,
                reason: "post-playback-command",
              });
              continue postPlayback;
            } else if (routedAction === "handled") {
              const nextProviderId = stateManager.getState().provider;
              if (nextProviderId !== postPlayProviderId) {
                postPlayProviderId = nextProviderId;
                resolvedProviderId = nextProviderId;
                sessionSoftProviderId = null;
                invalidateRecentEpisodeStream(currentEpisode);
                pendingSourceRefreshAction = "recover";
                pendingRecomputeSources = false;
                diagnosticsService.record({
                  category: "playback",
                  message: "Post-play provider switch staged for fresh resolve",
                  context: {
                    provider: nextProviderId,
                    titleId: title.id,
                    season: currentEpisode.season,
                    episode: currentEpisode.episode,
                  },
                });
              }
              continue postPlayback;
            } else if (
              postAction === "clear-cache" ||
              postAction === "reset-provider-health" ||
              postAction === "clear-history"
            ) {
              await handleShellAction({ action: postAction, container });
              continue postPlayback;
            } else if (routedAction === "pick-episode" && title.type === "series") {
              const { chooseEpisodeFromMetadata } = await import("@/session-flow");
              const selection = await chooseEpisodeFromMetadata({
                currentId: title.id,
                isAnime: stateManager.getState().mode === "anime",
                currentSeason: currentEpisode.season,
                currentEpisode: currentEpisode.episode,
                animeEpisodeCount: title.episodeCount,
                animeEpisodes: currentAnimeEpisodes,
                container,
              });
              if (!selection) {
                logger.info("Episode picker cancelled", {
                  titleId: title.id,
                  season: currentEpisode.season,
                  episode: currentEpisode.episode,
                });
                continue postPlayback;
              }
              const pickedEpisode = episodeInfoFromSelection({
                season: selection.season,
                episode: selection.episode,
                isAnime: stateManager.getState().mode === "anime",
                titleId: title.id,
                animeEpisodes: currentAnimeEpisodes,
              });
              pendingStart = await navigatePlaybackEpisode(pickedEpisode);
              playbackSession = this.transitionPlaybackSession(
                context,
                playbackSession,
                "episode-navigation",
                buildEpisodeNavigationTransitionContext({
                  titleId: title.id,
                  episode: pickedEpisode,
                  source: "episode-picker",
                }),
              );
              break postPlayback;
            } else {
              const navigationRoute = resolvePostPlaybackEpisodeNavigationRoute({
                action: postAction,
                titleType: title.type,
                availability: episodeAvailability,
              });
              if (navigationRoute) {
                pendingStart = await navigatePlaybackEpisode(navigationRoute.episode);
                playbackSession = this.transitionPlaybackSession(
                  context,
                  playbackSession,
                  "episode-navigation",
                  buildEpisodeNavigationTransitionContext({
                    titleId: title.id,
                    episode: navigationRoute.episode,
                    source: navigationRoute.source,
                  }),
                );
                break postPlayback;
              }
              if (
                postAction === "next" ||
                postAction === "previous" ||
                postAction === "next-season"
              ) {
                continue postPlayback;
              }
            }

            {
              logger.warn("Unhandled post-play shell action; staying on post-play menu", {
                postAction,
                routedAction,
                titleId: title.id,
                season: currentEpisode.season,
                episode: currentEpisode.episode,
              });
              continue postPlayback;
            }
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
        error: {
          code: "PLAYER_FAILED",
          message: String(e),
          retryable: false,
        },
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
    const { player, stateManager, config } = context.container;

    if (context.signal.aborted || playbackIterationSignal?.aborted) {
      throw new PlaybackAbortedError("playback aborted before launch");
    }

    const displayTitle =
      title.type === "movie"
        ? title.name
        : `${title.name} - S${String(episode.season).padStart(2, "0")}E${String(
            episode.episode,
          ).padStart(2, "0")}`;
    const subtitleStatus = describeSubtitleStatus(
      stream,
      stateManager.getState().mode === "anime"
        ? stateManager.getState().animeLanguageProfile.subtitle
        : stateManager.getState().seriesLanguageProfile.subtitle,
    );

    let bootstrapStallTimer: ReturnType<typeof setTimeout> | null = null;
    const clearBootstrapStallTimer = () => {
      if (bootstrapStallTimer !== null) {
        clearTimeout(bootstrapStallTimer);
        bootstrapStallTimer = null;
      }
    };

    try {
      this.updatePlaybackFeedback(context, {
        detail: "Launching player",
        note: subtitleStatus,
      });
      const initialSubtitleCount = stream.subtitleList?.length
        ? stream.subtitleList.length
        : stream.subtitle
          ? 1
          : undefined;
      let latestPresencePositionSeconds = startAt > 0 ? startAt : 0;
      let latestPresenceDurationSeconds = 0;
      this.updatePresenceInBackground(
        context,
        "presence.updatePlaybackLaunch",
        {
          mode: stateManager.getState().mode,
          title,
          episode,
          providerId: stateManager.getState().provider,
          stream,
          startedAtMs: Date.now(),
          positionSeconds: latestPresencePositionSeconds,
          subtitleCount: initialSubtitleCount,
        },
        correlation,
      );
      this.startLateSubtitleResolver({
        stream,
        title,
        episode,
        context,
        playbackIterationSignal,
      });
      const result = await player.play(stream, {
        url: stream.url,
        headers: stream.headers,
        subtitle: stream.subtitle,
        subtitleStatus,
        correlation,
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
        displayTitle,
        startAt,
        resumePromptAt,
        attach: false,
        playbackMode,
        timing,
        resumeStartChoicePrompt: suppressResumePrompt ? false : config.resumeStartChoicePrompt,
        autoSkipEnabled: !stateManager.getState().autoskipSessionPaused,
        skipRecap: config.skipRecap,
        skipIntro: config.skipIntro,
        skipPreview: config.skipPreview,
        skipCredits: config.skipCredits,
        onNearEof,
        onPlaybackEvent: (event) => {
          const startupStage = playbackStartupStageForPlayerEvent(event);
          if (startupStage) onStartupMark?.(startupStage);
          if (startupStage === "subtitle-attached") {
            clearBootstrapStallTimer();
            bootstrapStallTimer = setTimeout(() => {
              const status = stateManager.getState().playbackStatus;
              if (status === "playing" || status === "buffering" || status === "seeking") {
                return;
              }
              stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "stalled" });
              const route = formatPlaybackStreamRoute(stream);
              this.updatePlaybackFeedback(context, {
                detail: "Bootstrap stalled",
                note: [
                  "bootstrap-stall: no playback progress within 45s after subtitles",
                  route,
                  "o source · f fallback · purge via /commands",
                ]
                  .filter(Boolean)
                  .join(" · "),
              });
            }, 45_000);
          }
          if (startupStage === "first-progress" || event.type === "playback-started") {
            clearBootstrapStallTimer();
          }
          if (event.type !== "network-sample") {
            const feedback = this.describePlayerEvent(event);
            this.updatePlaybackFeedback(
              context,
              event.type === "stream-slow" || event.type === "stream-stalled"
                ? {
                    ...feedback,
                    note: [feedback.note, formatPlaybackStreamRoute(stream)]
                      .filter(Boolean)
                      .join(" · "),
                  }
                : feedback,
            );
          }
          if (event.type === "network-buffering") {
            stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "buffering" });
          } else if (event.type === "stream-stalled" || event.type === "ipc-stalled") {
            stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "stalled" });
          } else if (event.type === "seek-stalled") {
            stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "seeking" });
          } else if (event.type === "playback-started") {
            stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "playing" });
            // Update presence with accurate start time (after buffering)
            this.updatePresenceInBackground(
              context,
              "presence.updatePlaybackStarted",
              {
                mode: stateManager.getState().mode,
                title,
                episode,
                providerId: stateManager.getState().provider,
                stream,
                startedAtMs: Date.now(),
                positionSeconds: latestPresencePositionSeconds,
                durationSeconds: latestPresenceDurationSeconds,
                subtitleCount: undefined,
              },
              correlation,
            );
          } else if (event.type === "playback-progress") {
            latestPresencePositionSeconds = event.positionSeconds;
            latestPresenceDurationSeconds = event.durationSeconds;
            this.updatePresenceInBackground(
              context,
              "presence.updatePlaybackProgress",
              {
                mode: stateManager.getState().mode,
                title,
                episode,
                providerId: stateManager.getState().provider,
                stream,
                startedAtMs: Date.now(),
                positionSeconds: latestPresencePositionSeconds,
                durationSeconds: latestPresenceDurationSeconds,
              },
              correlation,
            );
          } else if (event.type === "late-subtitles-attached") {
            this.updatePresenceInBackground(
              context,
              "presence.updatePlaybackSubtitles",
              {
                mode: stateManager.getState().mode,
                title,
                episode,
                providerId: stateManager.getState().provider,
                stream,
                startedAtMs: Date.now(),
                positionSeconds: latestPresencePositionSeconds,
                durationSeconds: latestPresenceDurationSeconds,
                subtitleCount: event.trackCount,
              },
              correlation,
            );
          } else if (event.type === "playback-paused") {
            this.updatePresenceInBackground(
              context,
              "presence.updatePlaybackPaused",
              {
                mode: stateManager.getState().mode,
                title,
                episode,
                providerId: stateManager.getState().provider,
                stream,
                startedAtMs: Date.now(),
                positionSeconds: latestPresencePositionSeconds,
                durationSeconds: latestPresenceDurationSeconds,
                paused: true,
              },
              correlation,
            );
          } else if (event.type === "playback-resumed") {
            this.updatePresenceInBackground(
              context,
              "presence.updatePlaybackResumed",
              {
                mode: stateManager.getState().mode,
                title,
                episode,
                providerId: stateManager.getState().provider,
                stream,
                startedAtMs: Date.now(),
                positionSeconds: latestPresencePositionSeconds,
                durationSeconds: latestPresenceDurationSeconds,
              },
              correlation,
            );
          } else if (event.type === "track-changed") {
            // Keep session state aligned when users switch tracks directly in mpv.
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
          }
        },
        onPlayerReady: () => {
          this.updatePlaybackFeedback(context, {
            detail: "Player controls ready",
          });
          stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "ready" });
        },
      });

      stateManager.dispatch({ type: "SET_PLAYBACK_STATUS", status: "finished" });
      return result;
    } finally {
      clearBootstrapStallTimer();
      // Don't clear presence here — between autoplay-chain episodes we want
      // continuous "watching" presence like Netflix/Crunchyroll. The
      // updatePlayback at the start of the next episode will seamlessly
      // transition the activity. Presence is cleared only when the user
      // explicitly navigates away from playback (back_to_search or
      // back_to_results outcomes above).
    }
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
    provider: import("../services/providers/Provider").Provider | undefined;
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
    provider: import("../services/providers/Provider").Provider | undefined,
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

function describeSubtitleStatus(stream: StreamInfo, subLang: string): string {
  return describePlaybackSubtitleStatus(stream, subLang);
}
