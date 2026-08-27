export type YoutubeQualityEntry = {
  readonly label: string;
  readonly rank: number;
  readonly formatId: string;
};

/** Height in pixels for a `"720p"`, `"1080p"`, or `"4K"`-style label, or undefined for `best`/`auto`. */
export function youtubeQualityHeight(label: string | undefined): number | undefined {
  if (!label) return undefined;
  const trimmed = label.trim().toLowerCase();
  if (trimmed === "4k" || trimmed === "2160p") return 2160;
  if (trimmed === "8k" || trimmed === "4320p") return 4320;
  const match = trimmed.match(/(\d{3,4})\s*p/i);
  if (!match?.[1]) return undefined;
  const height = Number.parseInt(match[1], 10);
  return Number.isFinite(height) && height > 0 ? height : undefined;
}

/**
 * Pick the rendition to select for a requested quality.
 *
 * A quality preference is a **ceiling**, not a wish. The previous selector did
 * an exact label match and fell back to `qualityLabels[0]` — and that list is
 * sorted highest-first, so asking for 720p on a video that only publishes 1080p
 * and 480p silently handed back 1080p. Missing the ceiling has to round *down*:
 * the user asked not to exceed a height, usually for bandwidth.
 *
 * When nothing sits at or below the ceiling, the smallest available rendition is
 * the closest honest answer — still not what was asked for, but the closest
 * thing in the direction that was asked for.
 */
export function selectYoutubeQuality(
  entries: readonly YoutubeQualityEntry[],
  qualityPreference: string | undefined,
): YoutubeQualityEntry | undefined {
  const first = entries[0];
  if (!first) return undefined;
  if (!qualityPreference || qualityPreference === "best") return first;

  const exact = entries.find((entry) => entry.label === qualityPreference);
  if (exact) return exact;

  const ceiling = youtubeQualityHeight(qualityPreference);
  if (ceiling === undefined) return first;

  let bestUnderCeiling: YoutubeQualityEntry | undefined;
  let smallest: YoutubeQualityEntry = first;
  for (const entry of entries) {
    if (entry.rank <= ceiling && (!bestUnderCeiling || entry.rank > bestUnderCeiling.rank)) {
      bestUnderCeiling = entry;
    }
    if (entry.rank < smallest.rank) smallest = entry;
  }
  return bestUnderCeiling ?? smallest;
}
