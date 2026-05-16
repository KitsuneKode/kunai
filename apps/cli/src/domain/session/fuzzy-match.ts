export function fuzzyMatch(query: string, target: string): boolean {
  return fuzzyMatchScore(query, target) !== null;
}

export type FuzzyMatchTarget = {
  readonly value?: string | null;
  readonly weight?: number;
};

export function fuzzyMatchScore(query: string, target: string): number | null {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedTarget = target.toLowerCase();

  if (!normalizedQuery) return 0;
  if (!normalizedTarget) return null;
  if (normalizedTarget === normalizedQuery) return 0;
  if (normalizedTarget.startsWith(normalizedQuery)) {
    return 10 + normalizedTarget.length - normalizedQuery.length;
  }

  const wordIndex = normalizedTarget
    .split(/[\s/:._-]+/)
    .findIndex((word) => word.startsWith(normalizedQuery));
  if (wordIndex >= 0) return 25 + wordIndex;

  const includesIndex = normalizedTarget.indexOf(normalizedQuery);
  if (includesIndex >= 0) return 40 + includesIndex;

  let qi = 0;
  let firstMatch = -1;
  let previousMatch = -1;
  let gapPenalty = 0;
  for (let ti = 0; ti < normalizedTarget.length && qi < normalizedQuery.length; ti++) {
    if (normalizedTarget[ti] === normalizedQuery[qi]) {
      if (firstMatch === -1) firstMatch = ti;
      if (previousMatch >= 0) gapPenalty += Math.max(0, ti - previousMatch - 1);
      previousMatch = ti;
      qi++;
    }
  }
  if (qi !== normalizedQuery.length) return null;
  return 100 + firstMatch + gapPenalty * 2 + normalizedTarget.length - normalizedQuery.length;
}

export function bestFuzzyMatchScore(
  query: string,
  targets: readonly (string | FuzzyMatchTarget | null | undefined)[],
): number | null {
  let best: number | null = null;
  for (const target of targets) {
    if (!target) continue;
    const value = typeof target === "string" ? target : target.value;
    if (!value) continue;
    const weight = typeof target === "string" ? 0 : (target.weight ?? 0);
    const score = fuzzyMatchScore(query, value);
    if (score === null) continue;
    const weighted = score + weight;
    if (best === null || weighted < best) best = weighted;
  }
  return best;
}

export function rankFuzzyMatches<T>(
  items: readonly T[],
  query: string,
  getTargets: (item: T) => readonly (string | FuzzyMatchTarget | null | undefined)[],
): readonly T[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return items;

  return items
    .map((item, index) => ({
      item,
      index,
      score: bestFuzzyMatchScore(normalized, getTargets(item)),
    }))
    .filter(
      (entry): entry is { readonly item: T; readonly index: number; readonly score: number } =>
        entry.score !== null,
    )
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map((entry) => entry.item);
}
