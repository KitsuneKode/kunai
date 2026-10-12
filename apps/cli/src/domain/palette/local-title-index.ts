// =============================================================================
// local-title-index.ts — pure index + matcher for the universal `/` palette.
//
// The palette reads only LOCAL state (history, queue, followed titles, lists,
// playlists). Collection lives in services/palette — this file owns the
// vocabulary (LocalTitleEntry), dedupe, and the tiered matcher:
//
//   prefix > word-boundary > subsequence (fzf-lite)
//
// Everything here is synchronous and in-memory: entries are collected once per
// palette open, then re-filtered per keystroke — never a SQLite read per key.
// =============================================================================

import { mediaKindsToProviderLane } from "@/domain/provider-lane";
import type { ProviderLane } from "@/domain/types";
import type { HistoryProgress } from "@kunai/storage";
import type { MediaKind, ProviderExternalIds } from "@kunai/types";

/** Where a palette title row came from — also the dedupe precedence order. */
export type LocalTitleSource = "history" | "queue" | "followed" | "list" | "playlist";

const SOURCE_PRECEDENCE = {
  history: 0,
  queue: 1,
  followed: 2,
  list: 3,
  playlist: 4,
} satisfies Record<LocalTitleSource, number>;

export interface LocalTitleEntry {
  readonly titleId: string;
  readonly mediaKind: MediaKind;
  readonly contentType?: "movie" | "series";
  readonly title: string;
  readonly source: LocalTitleSource;
  readonly providerId?: string;
  readonly externalIds?: ProviderExternalIds;
  readonly season?: number;
  readonly episode?: number;
  readonly absoluteEpisode?: number;
  /**
   * Full history row when `source === "history"`. Selection reuses
   * `resolveHistorySelectionLaunch`, which needs the persisted row (position,
   * provider, watch state), not just the identity.
   */
  readonly historyEntry?: HistoryProgress;
  /** Queue row id when `source === "queue"` — a pick claims it via beginPlayback. */
  readonly queueEntryId?: string;
  /** ms epoch; higher = more recently touched. Tie-breaks equal-tier matches. */
  readonly recency?: number;
  /** Right-column hint already composed, e.g. "S2 E5 · history" or "watchlist". */
  readonly detail: string;
}

export interface LocalTitleMatch {
  readonly entry: LocalTitleEntry;
  /** Char ranges [start, end) on `entry.title` to render in palette.accent. */
  readonly ranges: readonly [number, number][];
}

export const LOCAL_TITLE_MIN_QUERY_LENGTH = 2;
export const LOCAL_TITLE_MATCH_LIMIT = 5;

// --- text folding ------------------------------------------------------------

type FoldedText = {
  readonly text: string;
  /** folded index -> original index */
  readonly toOriginal: readonly number[];
};

/**
 * Fold to a match-friendly lowercase form while keeping a map back to original
 * char positions. Diacritics fold to their base letter so "pokémon" matches
 * "pokemon" and the accent still lands on the real characters.
 */
function foldForMatch(value: string): FoldedText {
  const text: string[] = [];
  const toOriginal: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i] ?? "";
    const folded = char
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    if (!/[\p{L}\p{N}]/u.test(folded)) {
      pendingSpace = text.length > 0;
      continue;
    }
    if (pendingSpace) {
      text.push(" ");
      toOriginal.push(i);
      pendingSpace = false;
    }
    for (let j = 0; j < folded.length; j += 1) {
      text.push(folded[j] ?? "");
      toOriginal.push(i);
    }
  }
  return { text: text.join(""), toOriginal };
}

/** Dedupe key: punctuation-insensitive folded title. */
export function normalizeTitleKey(title: string): string {
  return foldForMatch(title)
    .text.replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isWordStart(text: string, index: number): boolean {
  return index === 0 || text[index - 1] === " ";
}

function toOriginalRanges(
  folded: FoldedText,
  positions: readonly number[],
): readonly [number, number][] {
  if (positions.length === 0) return [];
  const ranges: [number, number][] = [];
  let runStart = folded.toOriginal[positions[0] ?? 0] ?? 0;
  let runEnd = runStart + 1;
  for (let i = 1; i < positions.length; i += 1) {
    const original = folded.toOriginal[positions[i] ?? 0] ?? 0;
    if (original <= runEnd) {
      runEnd = Math.max(runEnd, original + 1);
      continue;
    }
    ranges.push([runStart, runEnd]);
    runStart = original;
    runEnd = original + 1;
  }
  ranges.push([runStart, runEnd]);
  return ranges;
}

// --- matcher -----------------------------------------------------------------

type ScoredMatch = {
  readonly entry: LocalTitleEntry;
  readonly tier: 0 | 1 | 2;
  readonly tierScore: number;
  readonly ranges: readonly [number, number][];
};

/**
 * Score one entry against an already-folded query.
 * Returns null when the entry does not match at all.
 */
function scoreLocalTitle(
  query: FoldedText,
  entry: LocalTitleEntry,
  foldedTitle: FoldedText,
): ScoredMatch | null {
  const needle = query.text;
  const haystack = foldedTitle.text;
  if (needle.length === 0 || haystack.length === 0) return null;

  if (haystack.startsWith(needle)) {
    const positions = Array.from({ length: needle.length }, (_, i) => i);
    return { entry, tier: 0, tierScore: 0, ranges: toOriginalRanges(foldedTitle, positions) };
  }

  for (let i = 1; i + needle.length <= haystack.length; i += 1) {
    if (!isWordStart(haystack, i)) continue;
    if (!haystack.startsWith(needle, i)) continue;
    const positions = Array.from({ length: needle.length }, (_, j) => i + j);
    return { entry, tier: 1, tierScore: i, ranges: toOriginalRanges(foldedTitle, positions) };
  }

  const positions: number[] = [];
  let cursor = 0;
  for (let i = 0; i < needle.length; i += 1) {
    const found = haystack.indexOf(needle[i] ?? "", cursor);
    if (found < 0) return null;
    positions.push(found);
    cursor = found + 1;
  }
  const span = (positions[positions.length - 1] ?? 0) - (positions[0] ?? 0);
  return { entry, tier: 2, tierScore: span, ranges: toOriginalRanges(foldedTitle, positions) };
}

/**
 * Dedupe by normalized title. First writer wins, so callers must feed sources
 * in precedence order (history first — it carries the richest launch anchor).
 */
export function dedupeLocalTitleEntries(entries: readonly LocalTitleEntry[]): LocalTitleEntry[] {
  const seen = new Set<string>();
  const deduped: LocalTitleEntry[] = [];
  for (const entry of entries) {
    const key = normalizeTitleKey(entry.title);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}

/**
 * Match locally-known titles against a palette query.
 * Empty/short queries return nothing — the title section exists only once the
 * user has typed at least two characters.
 */
export function matchLocalTitles(
  entries: readonly LocalTitleEntry[],
  rawQuery: string,
  limit: number = LOCAL_TITLE_MATCH_LIMIT,
): LocalTitleMatch[] {
  const query = foldForMatch(rawQuery.replace(/^\/+/, ""));
  if (query.text.length < LOCAL_TITLE_MIN_QUERY_LENGTH) return [];

  const scored: ScoredMatch[] = [];
  for (const entry of entries) {
    const match = scoreLocalTitle(query, entry, foldForMatch(entry.title));
    if (match) scored.push(match);
  }

  scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.tierScore !== b.tierScore) return a.tierScore - b.tierScore;
    const recency = (b.entry.recency ?? 0) - (a.entry.recency ?? 0);
    if (recency !== 0) return recency;
    const precedence = SOURCE_PRECEDENCE[a.entry.source] - SOURCE_PRECEDENCE[b.entry.source];
    if (precedence !== 0) return precedence;
    return a.entry.title.localeCompare(b.entry.title);
  });

  return scored.slice(0, Math.max(0, limit)).map((match) => ({
    entry: match.entry,
    ranges: match.ranges,
  }));
}

/** Provider lane a local title row belongs to — drives mode/provider routing. */
export function localTitleLane(entry: LocalTitleEntry): ProviderLane {
  return mediaKindsToProviderLane([entry.mediaKind]);
}
