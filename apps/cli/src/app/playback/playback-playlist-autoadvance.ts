import {
  evaluateAutoAdvanceNextUp,
  type AutoAdvanceGuards,
} from "@/app/playback/policies/auto-advance-policy";
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
}): NextUp | null {
  if (input.catalogNextEpisode) return null;
  return evaluateAutoAdvanceNextUp({
    guards: input.guards,
    nextEpisode: null,
    queueHead: input.queueHead,
    topRecommendation: null,
    seriesDone: !input.seriesHasNextEpisode,
    autoplayRecommendations: input.autoplayRecommendations,
  });
}
