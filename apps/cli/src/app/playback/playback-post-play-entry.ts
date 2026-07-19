import { routePlaybackShellAction } from "@/app-shell/command-router";
import { resolveCommandContext } from "@/app-shell/commands";
import type { PlaybackShellResult, PlaybackShellState } from "@/app-shell/types";
import {
  enqueueCurrentPlaybackDownload,
  handleShellAction,
  openTracksPanel,
} from "@/app-shell/workflows";
import type { EpisodePrefetchTarget } from "@/app/playback/episode-prefetch";
import type { PlaybackIteration } from "@/app/playback/playback-iteration";
import { switchPlaybackProviderFallback } from "@/app/playback/playback-provider-fallback";
import {
  enqueuePostPlaybackRecommendation,
  openPostPlaybackRecommendationActionPanel,
} from "@/app/playback/playback-recommendation-actions";
import type { PlaybackRunState } from "@/app/playback/playback-run-state";
import type {
  PlaybackSessionPhaseEvent,
  PlaybackSessionState,
} from "@/app/playback/playback-session-controller";
import type { PlaybackStartIntent } from "@/app/playback/playback-start-intent";
import type { AutoAdvanceGuards } from "@/app/playback/policies/auto-advance-policy";
import {
  runPostPlaybackMenu,
  type PostPlaybackMenuDeps,
} from "@/app/playback/run-post-playback-menu";
import type { StreamSelectionIntent } from "@/app/playback/source-quality";
import type { PostPlaybackRecommendationRail } from "@/app/post-play/post-playback-recommendations";
import type { Container } from "@/container";
import type { QuitNearEndThresholdMode } from "@/domain/playback/playback-policy";
import type { DecodedTrackSelection } from "@/domain/playback/track-capabilities";
import type { EpisodeInfo, ShellMode } from "@/domain/types";

export type CreatePostPlaybackMenuDepsInput = {
  readonly container: Container;
  readonly signal: AbortSignal;
  readonly quitNearEndBehavior: string;
  readonly quitNearEndThresholdMode: QuitNearEndThresholdMode;
  readonly recommendationRail: PostPlaybackRecommendationRail;
  readonly historyRepository: Container["historyRepository"];
  readonly diagnosticsService: Container["diagnosticsService"];

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
  readonly completeSourceTrackPick: (
    episode: EpisodeInfo,
    picked: DecodedTrackSelection,
    selection: StreamSelectionIntent | null,
    resumeSeconds: number,
    reason: string,
  ) => Promise<PlaybackStartIntent>;
  readonly handoffNextEpisodePrefetch: (
    target: EpisodePrefetchTarget,
    reason: "playback.prefetch-wait" | "post-playback.autonext.prefetch-wait",
  ) => Promise<void>;
  readonly buildPrefetchTarget: (episode: EpisodeInfo, providerId: string) => EpisodePrefetchTarget;
  readonly invalidateRecentEpisodeStream: (episode: EpisodeInfo) => void;
  readonly openPlaybackShell: (input: {
    container: Container;
    state: PlaybackShellState;
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
