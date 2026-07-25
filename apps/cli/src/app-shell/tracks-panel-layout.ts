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

/** Width below which the two-pane layout collapses to the stacked single column. */
export const TRACKS_TWO_PANE_MIN_WIDTH = 56;
/** Fixed width of the left section column in the two-pane layout. */
export const TRACKS_SECTION_COL_WIDTH = 22;

/**
 * Width the options pane actually gets for a given panel width. Shared so the
 * grid's column count is computed from the same number the renderer lays out
 * with — navigation stepping by a different column count than the one on screen
 * is what makes grid movement feel random.
 */
export function tracksOptionsPaneWidth(panelWidth: number): number {
  return panelWidth < TRACKS_TWO_PANE_MIN_WIDTH
    ? Math.max(12, panelWidth)
    : Math.max(12, panelWidth - TRACKS_SECTION_COL_WIDTH - 3);
}

/**
 * Rows the panel spends before a section body can start: the title line, the
 * counts line, the spacer, the section header, both overflow markers, and the
 * trailing hint. Both section renderers budget against this, so neither draws
 * past the height it was given and over whatever sits below the panel.
 */
export const TRACKS_PANE_CHROME_ROWS = 7;

/** Body rows a section may draw for a given panel height. */
export function tracksPaneVisibleRows(height: number | undefined, fallback = 18): number {
  return Math.max(1, (height ?? fallback) - TRACKS_PANE_CHROME_ROWS);
}

/** Narrowest a subtitle chip may be before the grid drops to fewer columns. */
export const SUBTITLE_CELL_MIN_WIDTH = 16;

/**
 * Columns in the subtitle grid for a given content width. Single source of
 * truth: the renderer draws this many per row and navigation steps by the same
 * number, so "down" cannot land on a different cell than the one below.
 */
export function subtitleGridColumns(width: number): number {
  return Math.max(1, Math.floor(Math.max(0, width) / SUBTITLE_CELL_MIN_WIDTH));
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

/**
 * Make repeated subtitle labels tellable apart.
 *
 * A merged list routinely carries several tracks with the same language name —
 * four "English" rows from different releases is normal once an external search
 * contributes tracks. Rendered as-is they are indistinguishable, so choosing one
 * is guesswork and re-choosing after a bad pick is impossible.
 *
 * Unique labels are returned untouched. Colliding ones take the first differing
 * `detail` (the release/native-label text) when there is one, and otherwise a
 * positional `#n` so every row still has its own identity.
 */
export function disambiguateSubtitleLabels(
  rows: readonly { readonly label: string; readonly detail?: string }[],
): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.label, (counts.get(row.label) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  return rows.map((row) => {
    if ((counts.get(row.label) ?? 0) < 2) return row.label;

    const ordinal = (seen.get(row.label) ?? 0) + 1;
    seen.set(row.label, ordinal);

    // The ordinal leads because chips are narrow and truncate from the right:
    // a discriminator placed after the release text is the first thing cut, and
    // four rows reading "English · Bytes…" are exactly as unpickable as four
    // reading "English". The detail follows as context when it adds any.
    const detail = row.detail?.trim();
    const numbered = `${row.label} #${String(ordinal)}`;
    return detail && detail !== row.label ? `${numbered} · ${detail}` : numbered;
  });
}

/**
 * Vertical window for the subtitle grid, in grid rows.
 *
 * The grid used to render every row it was given regardless of the height it
 * was allotted, so a long merged list drew straight through the bottom of the
 * panel and over whatever was beneath it. Keeps the focused cell in view.
 */
export function subtitleGridWindow(input: {
  readonly totalCells: number;
  readonly columns: number;
  readonly focusedIndex: number;
  /** Grid rows that fit; anything below 1 coerces to 1. */
  readonly visibleRows: number;
}): { readonly startRow: number; readonly endRow: number; readonly totalRows: number } {
  const columns = Math.max(1, Math.floor(input.columns));
  const totalRows = Math.ceil(Math.max(0, input.totalCells) / columns);
  const visibleRows = Math.max(1, Math.floor(input.visibleRows));
  if (totalRows <= visibleRows) return { startRow: 0, endRow: totalRows, totalRows };

  const focusedRow = Math.floor(Math.max(0, input.focusedIndex) / columns);
  // Centre the focused row, then clamp so the window never runs past either end.
  const start = Math.min(
    Math.max(0, focusedRow - Math.floor(visibleRows / 2)),
    totalRows - visibleRows,
  );
  return { startRow: start, endRow: start + visibleRows, totalRows };
}
