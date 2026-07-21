// Pure post-play decision predicates, extracted verbatim from PlaybackPhase.execute()
// (Stage 1 of docs/superpowers/plans/2026-06-13-playbackphase-execute-split.md).
// These take precomputed primitives so they are pure and unit-testable; callers
// still own when `endedNearNaturalEnd` is computed (no control-flow change).

/**
 * A "quit" near the natural end of an episode that should silently roll into the
 * next one (autoplay-chain), rather than parking on the post-play menu.
 */
export function isNearEndVoluntaryQuit(input: {
  readonly endReason: string;
  readonly quitNearEndBehavior: string;
  readonly sessionMode: string;
  readonly autoplayPaused: boolean;
  readonly stopAfterCurrent: boolean;
  readonly hasNextEpisode: boolean;
  readonly endedNearNaturalEnd: boolean;
}): boolean {
  return (
    input.endReason === "quit" &&
    input.quitNearEndBehavior === "continue" &&
    input.sessionMode === "autoplay-chain" &&
    !input.autoplayPaused &&
    !input.stopAfterCurrent &&
    input.hasNextEpisode &&
    input.endedNearNaturalEnd
  );
}

/**
 * Whether the post-play menu should offer "resume": there is meaningful watched
 * time, it is not effectively at the end, and it was not a natural EOF finish.
 */
export function canResumePlayback(input: {
  readonly resumeSeconds: number;
  readonly durationSeconds: number;
  readonly endReason: string;
  readonly endedNearNaturalEnd: boolean;
}): boolean {
  return (
    input.resumeSeconds > 10 &&
    (input.durationSeconds <= 0 || input.resumeSeconds < Math.max(0, input.durationSeconds - 5)) &&
    (input.endReason !== "eof" || !input.endedNearNaturalEnd)
  );
}

/**
 * Whether a natural finish with no next episode and an empty queue should
 * auto-continue into the top recommendation (YouTube-style continuous play).
 */
export function canAutoContinueIntoRecommendation(input: {
  readonly sessionMode: string;
  readonly hasNextEpisode: boolean;
  readonly endReason: string;
  readonly autoplayPaused: boolean;
  readonly autoplaySessionPaused: boolean;
  readonly aborted: boolean;
  readonly hasQueuedNext: boolean;
  readonly autoplayRecommendationsEnabled: boolean;
}): boolean {
  return (
    input.sessionMode === "autoplay-chain" &&
    !input.hasNextEpisode &&
    input.endReason === "eof" &&
    !input.autoplayPaused &&
    !input.autoplaySessionPaused &&
    !input.aborted &&
    !input.hasQueuedNext &&
    input.autoplayRecommendationsEnabled
  );
}

/** True when a recommendation id is safe to auto-play in youtube shell mode. */
export function isYoutubeSafeRecommendationId(id: string | undefined): boolean {
  const trimmed = id?.trim() ?? "";
  return (
    trimmed.startsWith("youtube:") ||
    trimmed.startsWith("youtube-playlist:") ||
    trimmed.startsWith("youtube-channel:")
  );
}

/**
 * Final gate before auto-continuing into a recommendation. YouTube mode must
 * only advance into youtube catalog ids (never TMDB leftovers).
 */
export function canAdvanceIntoRecommendation(input: {
  readonly shellMode: string;
  readonly recommendationId: string | undefined;
}): boolean {
  if (input.shellMode !== "youtube") return Boolean(input.recommendationId?.trim());
  return isYoutubeSafeRecommendationId(input.recommendationId);
}
