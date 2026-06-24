import type { MediaItemIdentity } from "@/domain/media/media-item-identity";
import { resolveNextUp, type NextUp } from "@/domain/playback/resolve-next-up";
import type { EpisodeInfo } from "@/domain/types";
import type { QueueEntry } from "@kunai/storage";

export type AutoAdvanceGuards = {
  readonly endReason: string;
  readonly autoplayPaused: boolean;
  readonly autoplaySessionPaused: boolean;
  readonly signalAborted: boolean;
};

export function shouldOfferAutoAdvance(guards: AutoAdvanceGuards): boolean {
  return (
    guards.endReason === "eof" &&
    !guards.autoplayPaused &&
    !guards.autoplaySessionPaused &&
    !guards.signalAborted
  );
}

export function evaluateAutoAdvanceNextUp(input: {
  readonly guards: AutoAdvanceGuards;
  readonly nextEpisode: EpisodeInfo | null;
  readonly queueHead: QueueEntry | undefined;
  readonly topRecommendation: MediaItemIdentity | null;
  readonly seriesDone: boolean;
  readonly autoplayRecommendations: boolean;
}): NextUp | null {
  if (!shouldOfferAutoAdvance(input.guards)) return null;
  return resolveNextUp({
    nextEpisode: input.nextEpisode,
    queueHead: input.queueHead,
    topRecommendation: input.topRecommendation,
    seriesDone: input.seriesDone,
    autoplayRecommendations: input.autoplayRecommendations,
  });
}
