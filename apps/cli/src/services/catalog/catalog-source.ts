// The catalog source contract: one capability, several sources, one walk.
//
// A capability (search, trending, calendar, …) is answered by an ordered list
// of sources: the lane's primary first, then stand-ins that return the SAME
// identity (TMDB ids for movies/series, AniList ids for anime). A stand-in
// that cannot prove identity does not belong in the list — no id beats a
// wrong id, because a wrong id plays, downloads and records the wrong title.
//
// `walkCatalogSources` owns the rules every capability used to re-implement:
// a caller abort is never an outage, a failed stand-in is skipped for a while
// instead of costing its timeout every time, and the ledger records who
// answered so /diagnostics can say so.

import {
  recordFallbackCatalogAnswer,
  recordPrimaryCatalogAnswer,
  type CatalogCapability,
  type CatalogLane,
} from "@/services/catalog/catalog-source-ledger";

export interface CatalogSource<T> {
  /** Stable id (`tmdb`, `tvmaze-wikidata`, …): ledger key and breaker key. */
  readonly id: string;
  /** What the user is shown for this source. */
  readonly name: string;
  load(signal: AbortSignal | undefined): Promise<T>;
}

export interface CatalogWalk<T> {
  readonly capability: CatalogCapability;
  readonly lane: CatalogLane;
  /** Primary first. */
  readonly sources: readonly CatalogSource<T>[];
  readonly signal?: AbortSignal;
  /**
   * Whether an answer is empty enough to try the next source. Default: never —
   * an honest empty answer from a working source is a verdict, not an outage.
   */
  readonly handsOver?: (value: T) => boolean;
}

export interface CatalogAnswer<T> {
  readonly value: T;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly fallback: boolean;
}

/** How long a stand-in that just failed is skipped. The primary is never skipped. */
export const CATALOG_FALLBACK_BREAKER_MS = 10 * 60 * 1000;

const brokenUntil = new Map<string, number>();
let clock: () => number = Date.now;

export function resetCatalogSourceBreakersForTest(next?: () => number): void {
  brokenUntil.clear();
  clock = next ?? Date.now;
}

function breakerKey(
  walk: Pick<CatalogWalk<never>, "capability" | "lane">,
  sourceId: string,
): string {
  return `${walk.capability}:${walk.lane}:${sourceId}`;
}

/**
 * Walk the sources in order and return the first usable answer. Rejects with
 * the caller's abort reason on cancel, and with the PRIMARY's error when every
 * source failed (the primary's failure is the one worth reporting).
 */
export async function walkCatalogSources<T>(walk: CatalogWalk<T>): Promise<CatalogAnswer<T>> {
  const [primary] = walk.sources;
  if (!primary) throw new Error(`No ${walk.capability} source for the ${walk.lane} lane`);
  let primaryError: unknown;
  let lastError: unknown;
  /** The first empty answer handed over; returned if no later source does better. */
  let handedOver: CatalogAnswer<T> | undefined;
  for (const source of walk.sources) {
    const isPrimary = source === primary;
    const key = breakerKey(walk, source.id);
    if (!isPrimary && (brokenUntil.get(key) ?? 0) > clock()) continue;
    walk.signal?.throwIfAborted();
    let value: T;
    try {
      value = await source.load(walk.signal);
    } catch (error) {
      if (walk.signal?.aborted) throw error;
      if (isPrimary) primaryError = error;
      else brokenUntil.set(key, clock() + CATALOG_FALLBACK_BREAKER_MS);
      lastError = error;
      continue;
    }
    if (!isPrimary) brokenUntil.delete(key);
    const answer: CatalogAnswer<T> = {
      value,
      sourceId: source.id,
      sourceName: source.name,
      fallback: !isPrimary,
    };
    const isLast = source === walk.sources[walk.sources.length - 1];
    if (!isLast && walk.handsOver?.(value) === true) {
      handedOver ??= answer;
      continue;
    }
    return recordAnswer(walk, primary, answer);
  }
  if (handedOver) return recordAnswer(walk, primary, handedOver);
  throw primaryError ?? lastError ?? new Error(`No ${walk.capability} source answered`);
}

function recordAnswer<T>(
  walk: CatalogWalk<T>,
  primary: CatalogSource<T>,
  answer: CatalogAnswer<T>,
): CatalogAnswer<T> {
  const source = {
    capability: walk.capability,
    lane: walk.lane,
    sourceId: answer.sourceId,
    sourceName: answer.sourceName,
  };
  if (answer.fallback) recordFallbackCatalogAnswer(source, `${primary.name} unavailable`);
  else recordPrimaryCatalogAnswer(source);
  return answer;
}
