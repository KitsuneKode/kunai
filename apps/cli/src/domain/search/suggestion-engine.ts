// =============================================================================
// Search suggestion engine — pure domain logic for the type-ahead band.
//
// Owns everything that must stay deterministic and unit-testable: the fzf-ish
// match scorer (prefix > word-boundary > subsequence, recency tiebreak), the
// Spotlight-style band assembly (local section + catalog section + skeletons +
// honest empty hint), the visibility predicate, and the ghost-completion suffix.
// No I/O, no timers, no network — the shell and services feed it data.
// =============================================================================

/** Minimum draft length before the band wakes up — matches the spec's "~2 chars". */
export const SUGGESTION_MIN_QUERY_LENGTH = 2;
/** Total item rows the band may show — keeps the anchored dropdown compact. */
export const SUGGESTION_MAX_ITEMS = 6;
/** Cap on the local section so catalog hits still get room. */
export const SUGGESTION_LOCAL_CAP = 3;

/** Where a suggestion came from. Drives grouping and the provenance badge. */
export type SuggestionSource =
  | "query-history" // a past submitted search — commits by re-running the query
  | "watched" // history_progress row
  | "followed" // followed_titles row
  | "list" // watchlist / favourites / custom list item
  | "playlist" // user playlist item
  | "catalog"; // fast registry-catalog hit (remote)

/**
 * One suggestable row. `value` carries the payload committed through the normal
 * selection pipeline (a SearchResult in the real wiring); `commitQuery` marks a
 * text-only row that commits by re-running the query instead.
 */
export interface SearchSuggestion<TValue = unknown> {
  readonly id: string;
  readonly title: string;
  readonly source: SuggestionSource;
  /** Right-aligned dim metadata ("2021 · Movie · 12 eps"). */
  readonly meta?: string;
  /** Provenance badge for local rows ("watched", "♥ your list", a list name). */
  readonly badge?: string;
  /** Epoch ms used only as the ordering tiebreak — higher is more recent. */
  readonly recencyMs?: number;
  readonly commitQuery?: string;
  readonly value?: TValue;
}

export interface ScoredSuggestion<TValue = unknown> {
  readonly suggestion: SearchSuggestion<TValue>;
  readonly score: number;
  /** Code-point indices into `suggestion.title` that matched the query. */
  readonly matchIndices: readonly number[];
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const SCORE_PREFIX = 300;
const SCORE_WORD_BOUNDARY = 200;
const SCORE_SUBSEQUENCE = 100;

function normalizeSuggestionText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Fold `title` into matchable code points — lowercased, diacritic-stripped,
 * whitespace-collapsed — while recording which original code point each kept
 * char came from, so `matchIndices` land on the displayable string.
 */
function normalizeWithIndexMap(title: string): { chars: string[]; origIndex: number[] } {
  const chars: string[] = [];
  const origIndex: number[] = [];
  let pendingSpace = false;
  let seenContent = false;
  Array.from(title).forEach((codePoint, i) => {
    for (const p of Array.from(codePoint.normalize("NFD").toLowerCase())) {
      if (/\p{M}/u.test(p)) continue;
      if (/\s/.test(p)) {
        if (seenContent) pendingSpace = true;
        continue;
      }
      if (pendingSpace) {
        chars.push(" ");
        origIndex.push(i);
        pendingSpace = false;
      }
      seenContent = true;
      chars.push(p);
      origIndex.push(i);
    }
  });
  return { chars, origIndex };
}

function isWordBoundaryChar(char: string): boolean {
  return !/[\p{L}\p{N}]/u.test(char);
}

/** Find `needle` as a contiguous substring in code-point space; -1 when absent. */
function indexOfSequence(haystack: readonly string[], needle: readonly string[]): number {
  outer: for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    for (let i = 0; i < needle.length; i += 1) {
      if (haystack[start + i] !== needle[i]) continue outer;
    }
    return start;
  }
  return -1;
}

/** Greedy left-to-right subsequence match; null when a char cannot be placed. */
function subsequenceIndices(
  haystack: readonly string[],
  needle: readonly string[],
): readonly number[] | null {
  const indices: number[] = [];
  let cursor = 0;
  for (const char of needle) {
    let found = -1;
    for (let i = cursor; i < haystack.length; i += 1) {
      if (haystack[i] === char) {
        found = i;
        break;
      }
    }
    if (found < 0) return null;
    indices.push(found);
    cursor = found + 1;
  }
  return indices;
}

function range(length: number, start = 0): readonly number[] {
  return Array.from({ length }, (_, i) => start + i);
}

/**
 * Score `title` against `query`, fzf-style. Returns null on no match.
 *
 * Tiers: prefix (300) > word-boundary substring (200) > subsequence (100),
 * where an interior contiguous substring is just a zero-gap subsequence and
 * lands at the top of the third tier naturally.
 */
export function scoreSuggestion(
  query: string,
  title: string,
): { readonly score: number; readonly matchIndices: readonly number[] } | null {
  const q = Array.from(normalizeSuggestionText(query));
  const { chars: t, origIndex } = normalizeWithIndexMap(title);
  if (q.length === 0 || q.length > t.length) return null;

  const toOriginal = (indices: readonly number[]) => indices.map((i) => origIndex[i] ?? i);

  // Prefix: tighter (shorter) titles win inside the tier.
  if (t.slice(0, q.length).every((c, i) => c === q[i])) {
    return {
      score: SCORE_PREFIX + Math.max(0, 30 - t.length),
      matchIndices: toOriginal(range(q.length)),
    };
  }

  const contiguous = indexOfSequence(t, q);
  if (contiguous >= 0 && (contiguous === 0 || isWordBoundaryChar(t[contiguous - 1] ?? ""))) {
    return {
      score: SCORE_WORD_BOUNDARY + Math.max(0, 20 - contiguous),
      matchIndices: toOriginal(range(q.length, contiguous)),
    };
  }

  const indices = subsequenceIndices(t, q);
  if (!indices) return null;
  let consecutive = 0;
  for (let i = 1; i < indices.length; i += 1) {
    if ((indices[i] ?? 0) === (indices[i - 1] ?? 0) + 1) consecutive += 1;
  }
  const spread = (indices[indices.length - 1] ?? 0) - (indices[0] ?? 0);
  const gaps = spread - (indices.length - 1);
  return {
    score: SCORE_SUBSEQUENCE + consecutive * 4 - gaps * 2 - (indices[0] ?? 0),
    matchIndices: toOriginal(indices),
  };
}

/**
 * Rank `suggestions` for `query`: score desc, then recency desc, then title,
 * then id — fully deterministic for equal-scored rows.
 */
export function rankSuggestions<TValue>(
  query: string,
  suggestions: readonly SearchSuggestion<TValue>[],
  limit: number,
): readonly ScoredSuggestion<TValue>[] {
  const scored = suggestions
    .map((suggestion) => {
      const match = scoreSuggestion(query, suggestion.title);
      return match ? { suggestion, score: match.score, matchIndices: match.matchIndices } : null;
    })
    .filter((entry): entry is ScoredSuggestion<TValue> => entry !== null);
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const recency = (b.suggestion.recencyMs ?? 0) - (a.suggestion.recencyMs ?? 0);
    if (recency !== 0) return recency;
    const byTitle = a.suggestion.title.localeCompare(b.suggestion.title);
    return byTitle !== 0 ? byTitle : a.suggestion.id.localeCompare(b.suggestion.id);
  });
  return scored.slice(0, Math.max(0, limit));
}

// ---------------------------------------------------------------------------
// Band assembly
// ---------------------------------------------------------------------------

export type SuggestionBandRow<TValue = unknown> =
  | { readonly kind: "header"; readonly label: string }
  | { readonly kind: "item"; readonly item: ScoredSuggestion<TValue> }
  | { readonly kind: "skeleton"; readonly skeletonIndex: number }
  | { readonly kind: "hint"; readonly label: string };

export interface SuggestionBandModel<TValue = unknown> {
  readonly rows: readonly SuggestionBandRow<TValue>[];
  /** Flat navigable items in visual order — what ↑/↓ and Enter see. */
  readonly items: readonly ScoredSuggestion<TValue>[];
}

export const SUGGESTION_LOCAL_HEADER = "From your list";
export const SUGGESTION_CATALOG_HEADER = "Catalog";
export const SUGGESTION_EMPTY_HINT = "keep typing · ↵ search anyway";

/**
 * Assemble the band's rows. Local rows are scored against the draft; catalog
 * rows keep upstream relevance order (the registry service already ranked
 * them) but are deduped against shown local rows and scored only for the
 * highlight indices.
 */
export function buildSuggestionBand<TValue>(input: {
  readonly query: string;
  readonly local: readonly SearchSuggestion<TValue>[];
  readonly remote: readonly SearchSuggestion<TValue>[];
  readonly remotePending: boolean;
  readonly maxItems?: number;
  readonly localCap?: number;
  readonly skeletonRows?: number;
}): SuggestionBandModel<TValue> {
  const maxItems = input.maxItems ?? SUGGESTION_MAX_ITEMS;
  const localCap = input.localCap ?? SUGGESTION_LOCAL_CAP;
  const skeletonRows = input.skeletonRows ?? 2;

  const rankedLocal = rankSuggestions(input.query, input.local, localCap);
  const seen = new Set(rankedLocal.map((entry) => normalizeSuggestionText(entry.suggestion.title)));
  const remoteItems: ScoredSuggestion<TValue>[] = [];
  for (const suggestion of input.remote) {
    if (seen.has(normalizeSuggestionText(suggestion.title))) continue;
    const match = scoreSuggestion(input.query, suggestion.title);
    remoteItems.push({
      suggestion,
      score: match?.score ?? 0,
      matchIndices: match?.matchIndices ?? [],
    });
    seen.add(normalizeSuggestionText(suggestion.title));
    if (remoteItems.length >= maxItems - rankedLocal.length) break;
  }

  const rows: SuggestionBandRow<TValue>[] = [];
  const items: ScoredSuggestion<TValue>[] = [...rankedLocal, ...remoteItems];

  if (rankedLocal.length > 0) {
    rows.push({ kind: "header", label: SUGGESTION_LOCAL_HEADER });
    for (const item of rankedLocal) rows.push({ kind: "item", item });
  }
  if (remoteItems.length > 0 || input.remotePending) {
    rows.push({ kind: "header", label: SUGGESTION_CATALOG_HEADER });
    for (const item of remoteItems) rows.push({ kind: "item", item });
    if (input.remotePending) {
      for (let i = 0; i < skeletonRows; i += 1) {
        rows.push({ kind: "skeleton", skeletonIndex: i });
      }
    }
  }
  if (items.length === 0 && !input.remotePending) {
    rows.push({ kind: "hint", label: SUGGESTION_EMPTY_HINT });
  }

  return { rows, items };
}

// ---------------------------------------------------------------------------
// Visibility predicate + ghost completion
// ---------------------------------------------------------------------------

/**
 * The whole "when does the band exist" contract in one pure predicate — the
 * unit tests pin it, the shell just feeds it live state.
 */
export function shouldShowSuggestionBand(input: {
  readonly query: string;
  readonly submittedQuery: string;
  readonly commandMode: boolean;
  readonly calendarView: boolean;
  readonly ultraCompact: boolean;
  readonly overlayActive: boolean;
  readonly searching: boolean;
  readonly dismissedForQuery: string | null;
  readonly minQueryLength?: number;
}): boolean {
  const min = input.minQueryLength ?? SUGGESTION_MIN_QUERY_LENGTH;
  const draft = input.query.trim();
  if (draft.length < min) return false;
  if (draft === input.submittedQuery.trim()) return false;
  if (input.dismissedForQuery !== null && input.dismissedForQuery === input.query) return false;
  return !(
    input.commandMode ||
    input.calendarView ||
    input.ultraCompact ||
    input.overlayActive ||
    input.searching
  );
}

/**
 * Dim completion shown after the cursor. Only honest prefix completions —
 * a subsequence hit is not something you can "accept to the end of the line".
 * Compares in the same accent-folded space as the scorer (so `ame` → `Amélie`
 * completes) while slicing the ORIGINAL title on code points, so multibyte
 * titles and diacritics come back intact.
 */
export function ghostCompletionSuffix(query: string, title: string): string | null {
  const q = Array.from(normalizeSuggestionText(query));
  if (q.length === 0) return null;
  const { chars, origIndex } = normalizeWithIndexMap(title);
  if (chars.length <= q.length) return null;
  if (!q.every((char, i) => char === chars[i])) return null;
  const lastMatched = origIndex[q.length - 1];
  if (lastMatched === undefined) return null;
  return (
    Array.from(title)
      .slice(lastMatched + 1)
      .join("") || null
  );
}
