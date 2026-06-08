// =============================================================================
// tracks-panel-layout.ts — pure layout helpers for the Tracks panel render.
// Counts-header composition + subtitle-grid row chunking. No Ink/React here.
// =============================================================================

export type TrackSectionCounts = {
  readonly provider?: number;
  readonly source: number;
  readonly quality: number;
  readonly audio: number;
  readonly subtitle: number;
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * "1 source · 3 qualities · 10 subtitles · <provider>" — omits zero counts; the
 * provider tail is optional. Audio has no plural form ("1 audio" / "2 audio").
 */
export function tracksCountsHeader(counts: TrackSectionCounts, provider?: string): string {
  return [
    counts.provider ? plural(counts.provider, "provider", "providers") : null,
    counts.source ? plural(counts.source, "source", "sources") : null,
    counts.quality ? plural(counts.quality, "quality", "qualities") : null,
    counts.audio ? plural(counts.audio, "audio", "audio") : null,
    counts.subtitle ? plural(counts.subtitle, "subtitle", "subtitles") : null,
    provider && provider.trim() ? provider.trim() : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

/** Wrap labels into rows of `columns` for the subtitle chip grid. `columns < 1` coerces to 1. */
export function chunkSubtitleGrid<T>(labels: readonly T[], columns: number): T[][] {
  const cols = Math.max(1, Math.floor(columns));
  const rows: T[][] = [];
  for (let index = 0; index < labels.length; index += cols) {
    rows.push(labels.slice(index, index + cols));
  }
  return rows;
}
