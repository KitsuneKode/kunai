// =============================================================================
// up-next.ts — unify the two "next" concepts into one decision
//
// The audit found two unrelated notions of "next": the autoplay episode chain
// (next episode of the current series/anime) and the cross-title queue. This pure
// resolver makes one explicit choice so the UI can show a single, honest "Up Next".
//
// Policy (Netflix-like): while autoplay is eligible and the current title has a
// next episode, that wins (binge the series). Otherwise fall back to the
// cross-title queue. Movies / paused autoplay never produce an episode-chain next.
// =============================================================================

import type { PlayableRef } from "./playable-ref";

export type UpNext =
  | { readonly kind: "episode-chain"; readonly ref: PlayableRef }
  | { readonly kind: "queue"; readonly ref: PlayableRef }
  | { readonly kind: "none" };

export function resolveUpNext(input: {
  /** Next episode of the current series/anime (autoplay chain), if any. */
  readonly nextEpisode?: PlayableRef | null;
  /** Head of the cross-title queue, if any. */
  readonly queueNext?: PlayableRef | null;
  /** False for movies, paused autoplay, or stop-after-current. */
  readonly autoplayEligible: boolean;
}): UpNext {
  if (input.autoplayEligible && input.nextEpisode) {
    return { kind: "episode-chain", ref: input.nextEpisode };
  }
  if (input.queueNext) {
    return { kind: "queue", ref: input.queueNext };
  }
  return { kind: "none" };
}
