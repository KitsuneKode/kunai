import {
  evaluateAutoAdvanceNextUp,
  type AutoAdvanceGuards,
} from "@/app/playback/policies/auto-advance-policy";
import type { MediaItemIdentity } from "@/domain/media/media-item-identity";
import type { NextUp } from "@/domain/playback/resolve-next-up";
import type { EpisodeInfo } from "@/domain/types";
import type { QueueEntry } from "@kunai/storage";

/**
 * Playlist auto-advance planning when catalog episode advance is unavailable.
 * Extracted from PlaybackPhase post-play outer loop.
 */
export function planPlaylistAutoAdvance(input: {
  readonly catalogNextEpisode: EpisodeInfo | null;
  readonly guards: AutoAdvanceGuards;
  readonly queueHead: QueueEntry | undefined;
  readonly seriesHasNextEpisode: boolean;
  readonly autoplayRecommendations: boolean;
  readonly topRecommendation: MediaItemIdentity | null;
}): NextUp | null {
  const nextUp = evaluateAutoAdvanceNextUp({
    guards: input.guards,
    // Pass the real catalog episode so an explicitly "play next" queue entry can
    // be ranked against it; previously this planner bailed whenever a catalog
    // episode existed, so the queue was only ever consulted at series end.
    nextEpisode: input.catalogNextEpisode,
    queueHead: input.queueHead,
    topRecommendation: input.topRecommendation,
    seriesDone: !input.seriesHasNextEpisode,
    autoplayRecommendations: input.autoplayRecommendations,
  });
  // The episode chain is the caller's own catalog-advance path; this planner
  // only reports the cross-title outcomes it is responsible for.
  return nextUp?.kind === "episode" ? null : nextUp;
}
