import { routePlaybackShellAction } from "@/app-shell/command-router";
import { resolveCommandContext } from "@/app-shell/commands";
import type { PlaybackShellResult, PlaybackShellState } from "@/app-shell/types";
import {
  enqueueCurrentPlaybackDownload,
  handleShellAction,
  openTracksPanel,
  openPlaybackEpisodePicker,
} from "@/app-shell/workflows";
import { episodeInfoFromSelection } from "@/app/bootstrap/episode-info-from-catalog";
import type { EpisodePrefetchTarget } from "@/app/playback/episode-prefetch";
import type { CatalogAdvancePlan } from "@/app/playback/playback-auto-advance";
import type { EpisodeAttempt } from "@/app/playback/playback-episode-attempt";
import type { EpisodeContext } from "@/app/playback/playback-episode-context";
import { buildPlaybackEpisodePickerOptions } from "@/app/playback/playback-episode-picker";
import { type PlaybackIteration, createPlaybackIteration } from "@/app/playback/playback-iteration";
import type { NextEpisodePrefetch } from "@/app/playback/playback-next-episode-prefetch";
import {
  updatePlaybackFeedback,
  transitionPlaybackSession,
} from "@/app/playback/playback-phase-feedback";
import type {
  PlaybackIterationStep,
  PlaybackLoopState,
} from "@/app/playback/playback-phase-session";
import { teardownPlaybackForPostPlayExit } from "@/app/playback/playback-post-play-lifecycle";
import { switchPlaybackProviderFallback } from "@/app/playback/playback-provider-fallback";
import {
  enqueuePostPlaybackRecommendation,
  openPostPlaybackRecommendationActionPanel,
} from "@/app/playback/playback-recommendation-actions";
import type { PlaybackRunState } from "@/app/playback/playback-run-state";
import {
  type PlaybackSessionPhaseEvent,
  type PlaybackSessionState,
  didPlaybackFailToStart,
} from "@/app/playback/playback-session-controller";
import type { PlaybackStartIntent } from "@/app/playback/playback-start-intent";
import type { ReadyEpisodeStream } from "@/app/playback/playback-stream-ready";
import type { AutoAdvanceGuards } from "@/app/playback/policies/auto-advance-policy";
import {
  runPostPlaybackMenu,
  type PostPlaybackMenuDeps,
} from "@/app/playback/run-post-playback-menu";
import type { PostPlaybackRecommendationRail } from "@/app/post-play/post-playback-recommendations";
import type { Container } from "@/container";
import { decodeEpisodeSelectionValue } from "@/domain/playback/episode-selection";
import type { QuitNearEndThresholdMode } from "@/domain/playback/playback-policy";
import type { EpisodeInfo, ShellMode, PlaybackResult } from "@/domain/types";
import { listReadyEpisodes } from "@/services/offline/offline-episode-index";

export type CreatePostPlaybackMenuDepsInput = {
  readonly container: Container;
  readonly signal: AbortSignal;
  readonly quitNearEndBehavior: string;
  readonly quitNearEndThresholdMode: QuitNearEndThresholdMode;
  readonly recommendationRail: PostPlaybackRecommendationRail;
  readonly historyRepository: Container["historyRepository"];
  readonly diagnosticsService: Container["diagnosticsService"];
  readonly readWatchedEntries: PostPlaybackMenuDeps["readWatchedEntries"];

  readonly getMode: () => ShellMode;
  readonly getAutoplaySessionPaused: () => boolean;
  readonly getAutoskipSessionPaused: () => boolean;
  readonly getProvider: () => string;
  readonly getAnimeSubtitlePreference: () => string;
  readonly getSeriesSubtitlePreference: () => string;
  readonly dispatchAutoplayPaused: (paused: boolean) => void;
  readonly dispatchAutoskipPaused: (paused: boolean) => void;
  readonly dispatchStopAfterCurrent: (enabled: boolean) => void;
  readonly dispatchWatchTimeSummary: (summary: string | null) => void;
  readonly updatePlaybackFeedback: (feedback: {
    detail?: string | null;
    note?: string | null;
  }) => void;
  readonly transitionPlaybackSession: (
    session: PlaybackSessionState,
    event: PlaybackSessionPhaseEvent,
    meta?: Record<string, unknown>,
  ) => PlaybackSessionState;
  readonly runAutoNextCountdown: (
    episode: EpisodeInfo,
  ) => Promise<"continue" | "cancelled" | "skipped">;
  readonly navigatePlaybackEpisode: (
    episode: EpisodeInfo,
    options?: {
      loadingOrder?: "before-start" | "after-start" | "none";
      resetStopAfterCurrent?: boolean;
      resumeInterruptedAutoplay?: boolean;
      cancelPrefetchReason?: string;
    },
  ) => Promise<PlaybackStartIntent>;
  readonly completeSourceTrackPick: PostPlaybackMenuDeps["completeSourceTrackPick"];
  readonly handoffNextEpisodePrefetch: (
    target: EpisodePrefetchTarget,
    reason: "playback.prefetch-wait" | "post-playback.autonext.prefetch-wait",
  ) => Promise<void>;
  readonly buildPrefetchTarget: (episode: EpisodeInfo, providerId: string) => EpisodePrefetchTarget;
  readonly invalidateRecentEpisodeStream: (episode: EpisodeInfo) => void;
  readonly openPlaybackShell: (input: {
    container: Container;
    state: PlaybackShellState;
    recommendationRail?: PostPlaybackRecommendationRail;
  }) => Promise<PlaybackShellResult>;
  readonly chooseEpisodeFromMetadata: PostPlaybackMenuDeps["chooseEpisodeFromMetadata"];
  readonly episodeInfoFromSelection: PostPlaybackMenuDeps["episodeInfoFromSelection"];
  readonly readAutoAdvanceGuards: () => AutoAdvanceGuards;
  readonly getCompatibleProviders: () => readonly { metadata: { id: string } }[];
  readonly teardownPlaybackForPostPlayExit: () => Promise<void>;
};

/** Factory for post-play menu deps — keeps PlaybackPhase episode loop thinner. */
export function createPostPlaybackMenuDeps(
  input: CreatePostPlaybackMenuDepsInput,
): PostPlaybackMenuDeps {
  const { container } = input;

  return {
    container: input.container,
    signal: input.signal,
    quitNearEndBehavior: input.quitNearEndBehavior,
    quitNearEndThresholdMode: input.quitNearEndThresholdMode,
    recommendationRail: input.recommendationRail,
    historyRepository: input.historyRepository,
    diagnosticsService: input.diagnosticsService,
    readWatchedEntries: input.readWatchedEntries,
    getMode: input.getMode,
    getAutoplaySessionPaused: input.getAutoplaySessionPaused,
    getAutoskipSessionPaused: input.getAutoskipSessionPaused,
    getProvider: input.getProvider,
    getAnimeSubtitlePreference: input.getAnimeSubtitlePreference,
    getSeriesSubtitlePreference: input.getSeriesSubtitlePreference,
    dispatchAutoplayPaused: input.dispatchAutoplayPaused,
    dispatchAutoskipPaused: input.dispatchAutoskipPaused,
    dispatchStopAfterCurrent: input.dispatchStopAfterCurrent,
    dispatchWatchTimeSummary: input.dispatchWatchTimeSummary,
    resolvePostPlaybackCommands: () =>
      resolveCommandContext(container.stateManager.getState(), "postPlayback"),
    routeShellAction: (action) => routePlaybackShellAction({ action, container }),
    updatePlaybackFeedback: input.updatePlaybackFeedback,
    transitionPlaybackSession: input.transitionPlaybackSession,
    runAutoNextCountdown: input.runAutoNextCountdown,
    navigatePlaybackEpisode: input.navigatePlaybackEpisode,
    completeSourceTrackPick: input.completeSourceTrackPick,
    handoffNextEpisodePrefetch: input.handoffNextEpisodePrefetch,
    buildPrefetchTarget: input.buildPrefetchTarget,
    invalidateRecentEpisodeStream: input.invalidateRecentEpisodeStream,
    openPlaybackShell: input.openPlaybackShell,
    openTracksPanel,
    chooseEpisodeFromMetadata: input.chooseEpisodeFromMetadata,
    episodeInfoFromSelection: input.episodeInfoFromSelection,
    readAutoAdvanceGuards: input.readAutoAdvanceGuards,
    getCompatibleProviders: input.getCompatibleProviders,
    switchPlaybackProviderFallback,
    teardownPlaybackForPostPlayExit: input.teardownPlaybackForPostPlayExit,
    enqueuePostPlaybackRecommendation,
    openPostPlaybackRecommendationActionPanel,
    handleShellAction,
    enqueueCurrentPlaybackDownload,
  };
}

export async function runPostPlaybackMenuAfterEpisode(input: {
  readonly run: PlaybackRunState;
  readonly iteration: PlaybackIteration;
  readonly deps: PostPlaybackMenuDeps;
}) {
  return runPostPlaybackMenu(input.run, input.iteration, input.deps);
}

/**
 * The post-playback menu for this episode — an inner loop, so unavailable
 * navigation actions stay in the menu instead of re-resolving the stream.
 * Returns the phase exit, or null when the menu restarts the playback loop.
 */
export async function runPostPlayMenu(
  loop: PlaybackLoopState,
  attempt: EpisodeAttempt,
  episodeContext: EpisodeContext,
  ready: ReadyEpisodeStream,
  prefetch: NextEpisodePrefetch,
  result: PlaybackResult,
  plan: CatalogAdvancePlan,
  upNext: {
    readonly stopAfterCurrentAtMenuEntry: boolean;
    readonly recommendationRail: PostPlaybackRecommendationRail;
  },
): Promise<PlaybackIterationStep | null> {
  const {
    context,
    host,
    title,
    run,
    historyTitleLookup,
    episodePrefetch,
    navigatePlaybackEpisode,
    invalidateRecentEpisodeStream,
  } = loop;
  const { container } = context;
  const { providerRegistry, stateManager, historyRepository, config, diagnosticsService } =
    container;
  const { currentEpisode, playbackIterationAbort, sourceAuthority, completeSourceTrackPick } =
    attempt;
  const {
    episodeAvailability,
    shellEpisodePicker,
    watchedEntries,
    currentAnimeEpisodes,
    isAnimePlayback,
    offlineTitleId,
    buildPrefetchTarget,
  } = episodeContext;
  const { effectiveTiming, preparedStream } = ready;
  const { handoffNextEpisodePrefetch } = prefetch;
  const { nextEpisode, catalogAutoplayEndBanner, readAutoAdvanceGuards } = plan;
  const { stopAfterCurrentAtMenuEntry, recommendationRail } = upNext;
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
    prefetchedRecommendationItems: prefetch.prefetchedRecommendationItems,
    currentAnimeEpisodes,
    preparedStream,
    resolvedProviderId: attempt.resolvedProviderId,
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
  attempt.resolvedProviderId = iteration.resolvedProviderId;
  if (postPlaybackResult.kind === "exit") {
    return postPlaybackResult.result;
  }
  if (postPlaybackResult.kind === "playlist-advance") {
    return { status: "success", value: postPlaybackResult.value };
  }
  return null;
}
