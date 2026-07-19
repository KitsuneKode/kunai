import type { MediaItemIdentity } from "@/domain/media/media-item-identity";
import { INTERRUPTING_QUEUE_PRIORITY } from "@/domain/queue/QueuePlanner";
import type { EpisodeInfo } from "@/domain/types";
import type { QueueEntry } from "@kunai/storage";

export type NextUp =
  | { readonly kind: "episode"; readonly episode: EpisodeInfo }
  | { readonly kind: "queue"; readonly entry: QueueEntry }
  | { readonly kind: "recommendation"; readonly item: MediaItemIdentity };

/**
 * Single decision for "what plays next": an explicitly "play next" queue head →
 * next episode → queue head → recommendation.
 *
 * Precedence is driven by the placement the user chose when queueing, which is
 * persisted as the entry's priority — not by a global setting. Only "play next"
 * interrupts a series mid-run; anything queued for later (including bulk
 * watchlist refills) waits for the episode chain to finish, so finishing S01E01
 * never yanks you into an unrelated title you never asked for right now.
 *
 * A recommendation is only offered when the current title is done AND the user has
 * autoplay-recommendations on. Pure — no I/O, fully testable.
 */
export function resolveNextUp(input: {
  readonly nextEpisode: EpisodeInfo | null;
  readonly queueHead: QueueEntry | undefined;
  readonly topRecommendation: MediaItemIdentity | null;
  readonly seriesDone: boolean;
  readonly autoplayRecommendations: boolean;
}): NextUp | null {
  const { queueHead } = input;
  if (queueHead && (queueHead.priority ?? 0) >= INTERRUPTING_QUEUE_PRIORITY) {
    return { kind: "queue", entry: queueHead };
  }
  if (input.nextEpisode) return { kind: "episode", episode: input.nextEpisode };
  if (queueHead) return { kind: "queue", entry: queueHead };
  if (input.seriesDone && input.autoplayRecommendations && input.topRecommendation) {
    return { kind: "recommendation", item: input.topRecommendation };
  }
  return null;
}
