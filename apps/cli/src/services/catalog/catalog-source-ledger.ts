// Which source answered each catalog capability, most recently.
//
// Catalog answers walk fallback chains (TMDB hosts → Wikidata, AniList →
// Kitsu → Jikan → saved list, live season → saved season). The user sees the
// answer; this records where it came from so /diagnostics can say "search came
// from Wikidata because TMDB was unreachable" instead of leaving a degraded
// catalog indistinguishable from a healthy one. Process-wide and bounded: one
// entry per capability and lane.

export type CatalogCapability = "search" | "trending" | "recommendations" | "series-episodes";
export type CatalogLane = "movie-series" | "anime";

export interface CatalogSourceAnswer {
  readonly capability: CatalogCapability;
  readonly lane: CatalogLane;
  /** Stable id of the source that answered (`tmdb`, `wikidata`, `kitsu`, `saved`). */
  readonly sourceId: string;
  /** What the user is shown for that source. */
  readonly sourceName: string;
  /** True when the primary source failed and a fallback answered. */
  readonly fallback: boolean;
  /** Why the primary did not answer (short, redacted, no URLs). */
  readonly reason?: string;
  readonly at: number;
}

const answers = new Map<string, CatalogSourceAnswer>();
let clock: () => number = Date.now;

function keyOf(capability: CatalogCapability, lane: CatalogLane): string {
  return `${capability}:${lane}`;
}

export function recordCatalogAnswer(answer: Omit<CatalogSourceAnswer, "at">): void {
  answers.set(keyOf(answer.capability, answer.lane), { ...answer, at: clock() });
}

/** Where a catalog answer came from. */
export interface CatalogAnswerSource {
  readonly capability: CatalogCapability;
  readonly lane: CatalogLane;
  readonly sourceId: string;
  readonly sourceName: string;
}

/** The lane's primary source answered. */
export function recordPrimaryCatalogAnswer(source: CatalogAnswerSource): void {
  recordCatalogAnswer({ ...source, fallback: false });
}

/** The primary failed (`reason`) and `source` answered instead. */
export function recordFallbackCatalogAnswer(source: CatalogAnswerSource, reason: string): void {
  recordCatalogAnswer({ ...source, fallback: true, reason });
}

/** Latest answer per capability and lane, oldest first. */
export function catalogAnswersSnapshot(): readonly CatalogSourceAnswer[] {
  return [...answers.values()].sort((left, right) => left.at - right.at);
}

export function resetCatalogSourceLedgerForTest(next?: () => number): void {
  answers.clear();
  clock = next ?? Date.now;
}

function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

const CAPABILITY_LABELS = {
  search: "search",
  trending: "trending",
  recommendations: "recommendations",
  "series-episodes": "episodes",
} satisfies Record<CatalogCapability, string>;

/** The diagnostics line for the ledger. */
export interface CatalogAnswersLine {
  readonly detail: string;
  /** True while any answer came from a fallback. */
  readonly degraded: boolean;
}

/**
 * One line per answer for the diagnostics panel, or null when nothing has
 * been answered yet. Degraded (fallback) answers are listed first.
 */
export function describeCatalogAnswers(
  snapshot: readonly CatalogSourceAnswer[],
  now: number,
): CatalogAnswersLine | null {
  if (snapshot.length === 0) return null;
  const ordered = [...snapshot].sort(
    (left, right) => Number(right.fallback) - Number(left.fallback) || right.at - left.at,
  );
  const parts = ordered.map((answer) => {
    const lane = answer.lane === "anime" ? "anime " : "";
    const why = answer.fallback && answer.reason ? ` (${answer.reason})` : "";
    return `${lane}${CAPABILITY_LABELS[answer.capability]}: ${answer.sourceName}${why} · ${formatAge(now - answer.at)}`;
  });
  return { detail: parts.join("  ·  "), degraded: ordered.some((answer) => answer.fallback) };
}
