import type { PlaybackTimingMetadata, PlaybackTimingSegment } from "@/domain/types";

export function mergeTimingMetadata(
  primary: PlaybackTimingMetadata | null,
  secondary: PlaybackTimingMetadata | null,
): PlaybackTimingMetadata | null {
  if (!primary && !secondary) return null;
  if (!primary) return secondary;
  if (!secondary) return primary;

  return {
    tmdbId: primary.tmdbId,
    type: primary.type,
    intro: preferUsable(primary.intro, secondary.intro),
    recap: preferUsable(primary.recap, secondary.recap),
    credits: preferUsable(primary.credits, secondary.credits),
    preview: preferUsable(primary.preview, secondary.preview),
  };
}

/**
 * A segment only counts if something could actually be skipped with it.
 *
 * `normalizeSegments` in `introdb.ts` builds a segment per upstream row without
 * dropping a degenerate one, so IntroDB can answer with `[{startMs: 0, endMs: 0}]`.
 * Choosing on `.length` alone treated that as "the primary source has intro
 * timing" and discarded a real AniSkip window in `secondary` — the skip prompt
 * then never appeared, even though a usable window had been fetched.
 *
 * The usable test mirrors `normalizeEndSeconds` in `infra/player/playback-skip.ts`,
 * which is what ultimately decides whether a segment can drive a skip.
 */
function preferUsable(
  primary: readonly PlaybackTimingSegment[],
  secondary: readonly PlaybackTimingSegment[],
): readonly PlaybackTimingSegment[] {
  if (primary.some(isUsableSegment)) return primary;
  if (secondary.some(isUsableSegment)) return secondary;
  // Neither can drive a skip; keep whichever is non-empty so callers that only
  // ask "did any source answer?" still see the primary's shape.
  return primary.length ? primary : secondary;
}

function isUsableSegment(segment: PlaybackTimingSegment): boolean {
  const { startMs, endMs } = segment;
  if (typeof endMs !== "number" || !Number.isFinite(endMs) || endMs <= 0) return false;
  // `findPlaybackSegmentAtPosition` also requires the window to move forwards, so
  // an inverted segment is not something this can defer to either. Checking only
  // the end let `{startMs: 9999, endMs: 1}` count as timing here and then be
  // dropped by the player — the same "present but unusable" shape the degenerate
  // `{0, 0}` case already caused.
  const start = typeof startMs === "number" && Number.isFinite(startMs) ? startMs : 0;
  return endMs > start;
}
