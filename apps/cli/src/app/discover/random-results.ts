import type { SearchResult } from "@/domain/types";

import { loadDiscoverResults, type DiscoverResultBundle } from "./discover-results";
import { loadDiscoveryList, loadSurpriseList } from "./discovery-lists";

export type RandomResultOptions = {
  readonly count?: number;
  readonly random?: () => number;
  readonly signal?: AbortSignal;
};

export async function loadRandomResults(
  container: Parameters<typeof loadDiscoverResults>[0],
  options: RandomResultOptions = {},
): Promise<DiscoverResultBundle> {
  const mode = container.stateManager.getState().mode;
  const random = options.random ?? Math.random;

  // YouTube: never mix TMDB discover into the tray — trending + surprise only.
  if (mode === "youtube") {
    const [trending, surprise] = await Promise.all([
      loadDiscoveryList(mode, options.signal).catch((): SearchResult[] => []),
      loadSurpriseList(mode, options.signal, { random }).catch((): SearchResult[] => []),
    ]);
    const pool = buildStratifiedRandomPool(trending, [], surprise, random);
    return buildRandomResultBundle(pool, withConfiguredCount(container, options));
  }

  const [trending, lightDiscover, surprise] = await Promise.all([
    loadDiscoveryList(mode, options.signal).catch((): SearchResult[] => []),
    // Degrades like its two siblings. Without this catch one failing source took
    // down the whole command, while the empty-state copy promised the opposite.
    loadDiscoverResults(container, { light: true }).catch(() => ({
      results: [] as SearchResult[],
    })),
    loadSurpriseList(mode, options.signal, { random }).catch((): SearchResult[] => []),
  ]);

  const pool = buildStratifiedRandomPool(trending, lightDiscover.results, surprise, random);
  return buildRandomResultBundle(pool, withConfiguredCount(container, options));
}

export async function loadSurpriseResults(
  container: Parameters<typeof loadDiscoverResults>[0],
  options: RandomResultOptions = {},
): Promise<DiscoverResultBundle> {
  const mode = container.stateManager.getState().mode;
  const random = options.random ?? Math.random;
  const [surprise, trending] = await Promise.all([
    loadSurpriseList(mode, options.signal, { random }).catch((): SearchResult[] => []),
    loadDiscoveryList(mode, options.signal).catch((): SearchResult[] => []),
  ]);

  const pick = pickSurpriseCandidate([...surprise, ...trending], random);
  const results = pick ? [stampSpinPick(pick, "Surprise pick")] : [];

  return {
    results,
    subtitle:
      results.length > 0
        ? "1 surprise pick · /surprise to spin again · /random for a tray"
        : "No surprise pick available yet",
    emptyMessage:
      "Surprise needs trending or catalog signals. Try /trending first, then /surprise again.",
  };
}

/**
 * Apply the user's `discoverItemLimit` unless the caller named a count.
 *
 * Settings advertises this control over `/discover`, `/random`, and `/surprise`,
 * but only `/discover` ever read it: the tray was hard-clamped to five, and the
 * setting's smallest option is twelve, so no configured value could ever take
 * effect. A setting that is persisted and ignored is the failure this codebase
 * treats as a bug.
 */
function withConfiguredCount(
  container: Parameters<typeof loadDiscoverResults>[0],
  options: RandomResultOptions,
): RandomResultOptions {
  if (options.count !== undefined) return options;
  const configured = container.config.discoverItemLimit;
  return typeof configured === "number" && configured > 0
    ? { ...options, count: configured }
    : options;
}

export function buildRandomResultBundle(
  pool: readonly SearchResult[],
  options: RandomResultOptions = {},
): DiscoverResultBundle {
  const results = buildRandomResultTray(pool, options);

  return {
    results,
    subtitle:
      results.length > 0
        ? `${results.length} random picks · /random to reshuffle · /surprise for one pick`
        : "No random picks available yet",
    emptyMessage:
      "Random needs trending or recommendation signals. Try /trending or finish something from history.",
  };
}

/** Size of the quota block at the head of a stratified pool (2 surprise + 2 trending + 2 discover). */
export const STRATIFIED_HEAD = 6;

export function buildStratifiedRandomPool(
  trending: readonly SearchResult[],
  discover: readonly SearchResult[],
  surprise: readonly SearchResult[],
  random: () => number,
): readonly SearchResult[] {
  const mixed: SearchResult[] = [];
  const seen = new Set<string>();

  const quotas = [
    { pool: surprise, count: 2 },
    { pool: trending, count: 2 },
    { pool: discover, count: 2 },
  ] as const;
  // Kept in step with STRATIFIED_HEAD: the quota block is the part of the pool
  // whose ordering is meaningful, so the tray builder must not reshuffle it.

  for (const { pool, count } of quotas) {
    for (const result of shuffleResults(pool, random).slice(0, count)) {
      pushUnique(mixed, seen, result);
    }
  }

  for (const pool of [surprise, trending, discover]) {
    for (const result of pool) {
      pushUnique(mixed, seen, result);
      if (mixed.length >= 18) break;
    }
    if (mixed.length >= 18) break;
  }

  return mixed;
}

export function pickSurpriseCandidate(
  pool: readonly SearchResult[],
  random: () => number,
): SearchResult | null {
  if (pool.length === 0) return null;

  const quality = pool.filter(isSpinQualityCandidate);
  const candidates = quality.length > 0 ? quality : pool.filter((result) => result.title.trim());
  if (candidates.length === 0) return null;

  return candidates[Math.floor(random() * candidates.length)] ?? null;
}

function isSpinQualityCandidate(result: SearchResult): boolean {
  if (!result.title.trim()) return false;
  if (result.posterPath) return true;
  if (typeof result.rating === "number" && result.rating >= 5.5) return true;
  if (typeof result.popularity === "number" && result.popularity >= 20) return true;
  return Boolean(result.overview?.trim());
}

function stampSpinPick(result: SearchResult, prefix: string): SearchResult {
  return {
    ...result,
    metadataSource: [prefix, result.metadataSource].filter(Boolean).join(" · "),
  };
}

function pushUnique(target: SearchResult[], seen: Set<string>, result: SearchResult): void {
  const key = `${result.type}:${result.id}`;
  if (seen.has(key)) return;
  seen.add(key);
  target.push(result);
}

/** Matches the `discoverItemLimit` bounds so a configured tray size is honoured. */
const MIN_RANDOM_TRAY = 1;
const MAX_RANDOM_TRAY = 80;
const DEFAULT_RANDOM_TRAY = 12;

export function buildRandomResultTray(
  results: readonly SearchResult[],
  options: RandomResultOptions = {},
): readonly SearchResult[] {
  const count = Math.max(
    MIN_RANDOM_TRAY,
    Math.min(MAX_RANDOM_TRAY, options.count ?? DEFAULT_RANDOM_TRAY),
  );
  const random = options.random ?? Math.random;

  // Take the stratified head as-is, then shuffle only what is appended.
  // Shuffling the whole pool made `buildStratifiedRandomPool`'s 2/2/2 quota
  // meaningless -- a uniform shuffle discards the ordering the quota exists to
  // produce, so a large surprise pool could fill the entire tray.
  const head = results.slice(0, Math.min(STRATIFIED_HEAD, count));
  const tail = shuffleResults(results.slice(head.length), random).slice(0, count - head.length);

  return [...head, ...tail].map((result) => stampSpinPick(result, "Random pick"));
}

function shuffleResults(results: readonly SearchResult[], random: () => number): SearchResult[] {
  const shuffled = [...results];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    const current = shuffled[index];
    const replacement = shuffled[target];
    if (!current || !replacement) continue;
    shuffled[index] = replacement;
    shuffled[target] = current;
  }
  return shuffled;
}
