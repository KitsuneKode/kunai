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
  const [trending, lightDiscover, surprise] = await Promise.all([
    loadDiscoveryList(mode, options.signal).catch((): SearchResult[] => []),
    loadDiscoverResults(container, { light: true }),
    loadSurpriseList(mode, options.signal, { random }).catch((): SearchResult[] => []),
  ]);

  const pool = buildStratifiedRandomPool(trending, lightDiscover.results, surprise, random);
  return buildRandomResultBundle(pool, options);
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

export function mixRandomCandidatePools(
  discoverResults: readonly SearchResult[],
  surpriseResults: readonly SearchResult[],
): readonly SearchResult[] {
  const mixed: SearchResult[] = [];
  const seen = new Set<string>();
  const maxLength = Math.max(discoverResults.length, surpriseResults.length);

  for (let index = 0; index < maxLength; index += 1) {
    const surprise = surpriseResults[index];
    if (surprise) pushUnique(mixed, seen, surprise);
    const discover = discoverResults[index];
    if (discover) pushUnique(mixed, seen, discover);
  }

  return mixed;
}

function pushUnique(target: SearchResult[], seen: Set<string>, result: SearchResult): void {
  const key = `${result.type}:${result.id}`;
  if (seen.has(key)) return;
  seen.add(key);
  target.push(result);
}

export function buildRandomResultTray(
  results: readonly SearchResult[],
  options: RandomResultOptions = {},
): readonly SearchResult[] {
  const count = Math.max(1, Math.min(5, options.count ?? 5));
  const random = options.random ?? Math.random;
  const shuffled = shuffleResults(results, random);

  return shuffled.slice(0, count).map((result) => stampSpinPick(result, "Random pick"));
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
