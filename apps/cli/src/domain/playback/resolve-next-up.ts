import type { MediaItemIdentity } from "@/domain/media/media-item-identity";
import type { EpisodeInfo } from "@/domain/types";
import type { QueueEntry } from "@kunai/storage";

export type NextUp =
  | { readonly kind: "episode"; readonly episode: EpisodeInfo }
  | { readonly kind: "queue"; readonly entry: QueueEntry }
  | { readonly kind: "recommendation"; readonly item: MediaItemIdentity };

/**
 * Single decision for "what plays next": next episode → queue head → recommendation.
 * A recommendation is only offered when the current title is done AND the user has
 * autoplay-recommendations on. Pure — no I/O, fully testable. The one new piece of
 * logic for the Up Next spine; everything else wires this to QueueService + the
 * existing autoplay countdown.
 */
export function resolveNextUp(input: {
  readonly nextEpisode: EpisodeInfo | null;
  readonly queueHead: QueueEntry | undefined;
  readonly topRecommendation: MediaItemIdentity | null;
  readonly seriesDone: boolean;
  readonly autoplayRecommendations: boolean;
}): NextUp | null {
  if (input.nextEpisode) return { kind: "episode", episode: input.nextEpisode };
  if (input.queueHead) return { kind: "queue", entry: input.queueHead };
  if (input.seriesDone && input.autoplayRecommendations && input.topRecommendation) {
    return { kind: "recommendation", item: input.topRecommendation };
  }
  return null;
}
