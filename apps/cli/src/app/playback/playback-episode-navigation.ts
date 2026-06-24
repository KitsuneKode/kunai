import type { PlaybackSessionState } from "@/app/playback/playback-session-controller";
import type { PlaybackStartIntent } from "@/app/playback/playback-start-intent";
import type { EpisodeInfo } from "@/domain/types";

export type EpisodeNavigationLoadingOrder = "before-start" | "after-start" | "none";

export type PlaybackEpisodeNavigationEffects = {
  readonly cancelPrefetch?: (reason: string) => void;
  readonly showLoadingOverlay?: (episode: EpisodeInfo) => Promise<void>;
  readonly startNavigationToEpisode: (episode: EpisodeInfo) => Promise<PlaybackStartIntent>;
  readonly selectEpisode: (episode: EpisodeInfo) => void;
  readonly setStopAfterCurrent?: (enabled: boolean) => void;
  readonly setAutoplayPaused?: (paused: boolean) => void;
};

export async function applyPlaybackEpisodeNavigation(input: {
  readonly episode: EpisodeInfo;
  readonly session: PlaybackSessionState;
  readonly cancelPrefetchReason?: string;
  readonly loadingOrder?: EpisodeNavigationLoadingOrder;
  readonly resetStopAfterCurrent?: boolean;
  readonly resumeInterruptedAutoplay?: boolean;
  readonly effects: PlaybackEpisodeNavigationEffects;
}): Promise<{
  readonly startIntent: PlaybackStartIntent;
  readonly session: PlaybackSessionState;
}> {
  const loadingOrder = input.loadingOrder ?? "none";
  const { effects, episode } = input;

  if (input.cancelPrefetchReason) {
    effects.cancelPrefetch?.(input.cancelPrefetchReason);
  }

  if (loadingOrder === "before-start") {
    await effects.showLoadingOverlay?.(episode);
  }

  const startIntent = await effects.startNavigationToEpisode(episode);

  if (loadingOrder === "after-start") {
    await effects.showLoadingOverlay?.(episode);
  }

  effects.selectEpisode(episode);

  let session = input.session;
  if (input.resetStopAfterCurrent) {
    effects.setStopAfterCurrent?.(false);
    if (input.resumeInterruptedAutoplay && session.autoplayPauseReason === "interrupted") {
      effects.setAutoplayPaused?.(false);
      session = {
        ...session,
        stopAfterCurrent: false,
        autoplayPaused: false,
        autoplayPauseReason: null,
      };
    } else {
      session = { ...session, stopAfterCurrent: false };
    }
  }

  return { startIntent, session };
}

export function buildEpisodeNavigationTransitionContext(input: {
  readonly titleId: string;
  readonly episode: EpisodeInfo;
  readonly source?: "next" | "previous" | "next-season" | "episode-picker";
}): {
  readonly titleId: string;
  readonly season: number;
  readonly episode: number;
  readonly source?: "next" | "previous" | "next-season" | "episode-picker";
} {
  return {
    titleId: input.titleId,
    season: input.episode.season,
    episode: input.episode.episode,
    source: input.source,
  };
}
