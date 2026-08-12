// =============================================================================
// Playback Generation
//
// A monotonic (process, cycle) pair that identifies one mpv process and one
// playback cycle inside it. Every asynchronous playback boundary captures the
// generation that created it and compares before mutating current state, so a
// replaced, stopped, or disposed session cannot be revived by late work.
// =============================================================================

export type PlaybackGeneration = {
  readonly process: number;
  readonly cycle: number;
};

export const INITIAL_PLAYBACK_GENERATION: PlaybackGeneration = {
  process: 0,
  cycle: 0,
};

export function isSamePlaybackGeneration(
  left: PlaybackGeneration,
  right: PlaybackGeneration,
): boolean {
  return left.process === right.process && left.cycle === right.cycle;
}

/** Lexicographic: a newer process always wins, then a newer cycle inside it. */
export function isPlaybackGenerationAfter(
  candidate: PlaybackGeneration,
  current: PlaybackGeneration,
): boolean {
  if (candidate.process !== current.process) return candidate.process > current.process;
  return candidate.cycle > current.cycle;
}
