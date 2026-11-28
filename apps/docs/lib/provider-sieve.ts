import type { HomeCommandMetadata, HomeProviderMetadata } from "@/components/home/types";

export type DirectoryLane = "anime" | "series" | "youtube";
export type DirectoryLaneFilter = "all" | DirectoryLane;
export type HeroLane = "anime" | "series" | "movie" | "youtube";

export type MatchRange = readonly [start: number, end: number];

export type FuzzyMatch = {
  readonly score: number;
  readonly ranges: readonly MatchRange[];
};

export type RankedProvider = {
  readonly provider: HomeProviderMetadata;
  readonly lane: DirectoryLane;
  readonly score: number;
  readonly nameRanges: readonly MatchRange[];
  readonly domainRanges: readonly MatchRange[];
};

export type RankedCommand = {
  readonly command: HomeCommandMetadata;
  readonly score: number;
  readonly idRanges: readonly MatchRange[];
  readonly descRanges: readonly MatchRange[];
};

/** Classify a provider into its CLI mode lane strictly from its declared `mediaKinds`. */
export function providerLane(provider: Pick<HomeProviderMetadata, "mediaKinds">): DirectoryLane {
  const kinds = new Set(provider.mediaKinds.map((kind) => kind.toLowerCase()));
  if (kinds.has("video") || kinds.has("youtube")) return "youtube";
  if (kinds.has("anime") && !kinds.has("series") && !kinds.has("movie")) return "anime";
  if (kinds.has("series") || kinds.has("movie")) return "series";
  return "anime";
}

/** Providers per directory lane: how many exist and how many are recommended. */
export interface LaneCount {
  total: number;
  recommended: number;
}

export type LaneProviderCounts = Record<DirectoryLane, LaneCount>;

export function countProvidersByLane(
  providers: readonly HomeProviderMetadata[],
): LaneProviderCounts {
  const counts: LaneProviderCounts = {
    anime: { total: 0, recommended: 0 },
    series: { total: 0, recommended: 0 },
    youtube: { total: 0, recommended: 0 },
  };
  for (const provider of providers) {
    const lane = providerLane(provider);
    counts[lane].total += 1;
    if (provider.recommended) counts[lane].recommended += 1;
  }
  return counts;
}

/**
 * Pure subsequence fuzzy matcher inspired by Sieve.
 * Ranks contiguous runs and word-boundary hits highest, returning merged
 * `[start, end)` highlight spans for matched characters.
 */
export function sieveMatch(text: string, rawQuery: string): FuzzyMatch | null {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return { score: 0, ranges: [] };

  const target = text.toLowerCase();
  let qi = 0;
  let score = 0;
  let streak = 0;
  const indices: number[] = [];

  for (let ti = 0; ti < target.length && qi < query.length; ti += 1) {
    if (target[ti] === query[qi]) {
      indices.push(ti);
      streak += 1;
      score += 10 + streak * 8;
      if (ti === 0) score += 24;
      else {
        const prev = target[ti - 1];
        if (prev === " " || prev === "-" || prev === "." || prev === "/" || prev === "_") {
          score += 14;
        }
      }
      qi += 1;
    } else {
      streak = 0;
    }
  }

  if (qi < query.length) return null;

  // Prefer tighter spans and shorter targets when scores otherwise tie.
  const first = indices[0] ?? 0;
  const last = indices[indices.length - 1] ?? first;
  const spread = last - first + 1;
  if (spread === query.length) score += 28;
  score -= Math.min(20, spread - query.length);
  score -= Math.min(12, Math.floor((target.length - query.length) / 4));

  const firstIdx = indices[0];
  if (firstIdx === undefined) return null;

  const ranges: MatchRange[] = [];
  let start = firstIdx;
  let end = start + 1;
  for (const idx of indices.slice(1)) {
    if (idx === end) {
      end += 1;
    } else {
      ranges.push([start, end]);
      start = idx;
      end = idx + 1;
    }
  }
  ranges.push([start, end]);

  return { score, ranges };
}

export function filterProviders(
  providers: readonly HomeProviderMetadata[],
  query: string,
  laneFilter: DirectoryLaneFilter = "all",
): readonly RankedProvider[] {
  const cleaned = query.trim();
  const ranked: RankedProvider[] = [];

  for (const provider of providers) {
    const lane = providerLane(provider);
    if (laneFilter !== "all" && lane !== laneFilter) continue;

    if (!cleaned) {
      ranked.push({
        provider,
        lane,
        score: provider.recommended ? 10 : 0,
        nameRanges: [],
        domainRanges: [],
      });
      continue;
    }

    const nameHit = sieveMatch(provider.displayName, cleaned);
    const domainHit = sieveMatch(provider.domain, cleaned);
    const capHit = sieveMatch(provider.capabilities.join(" "), cleaned);
    const descHit = sieveMatch(provider.description, cleaned);

    if (!nameHit && !domainHit && !capHit && !descHit) continue;

    const bestScore = Math.max(
      nameHit ? nameHit.score + 40 : -Infinity,
      domainHit ? domainHit.score + 20 : -Infinity,
      capHit ? capHit.score + 6 : -Infinity,
      descHit ? descHit.score : -Infinity,
    );

    ranked.push({
      provider,
      lane,
      score: bestScore + (provider.recommended ? 4 : 0),
      nameRanges: nameHit?.ranges ?? [],
      domainRanges: domainHit?.ranges ?? [],
    });
  }

  return ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.provider.recommended !== b.provider.recommended) {
      return Number(b.provider.recommended) - Number(a.provider.recommended);
    }
    return a.provider.displayName.localeCompare(b.provider.displayName);
  });
}

export function filterCommands(
  commands: readonly HomeCommandMetadata[],
  query: string,
  limit = 16,
): readonly RankedCommand[] {
  const cleaned = query.trim().replace(/^\//, "");
  if (!cleaned) {
    return commands.slice(0, limit).map((command) => ({
      command,
      score: 0,
      idRanges: [],
      descRanges: [],
    }));
  }

  const ranked: RankedCommand[] = [];
  for (const command of commands) {
    const idHit = sieveMatch(command.id, cleaned);
    const labelHit = sieveMatch(command.label, cleaned);
    const aliasHit = command.aliases?.reduce<FuzzyMatch | null>((best, alias) => {
      const hit = sieveMatch(alias, cleaned);
      if (!hit) return best;
      return !best || hit.score > best.score ? hit : best;
    }, null);
    const descHit = sieveMatch(command.description, cleaned);

    if (!idHit && !labelHit && !aliasHit && !descHit) continue;

    const score = Math.max(
      idHit ? idHit.score + 50 : -Infinity,
      aliasHit ? aliasHit.score + 36 : -Infinity,
      labelHit ? labelHit.score + 24 : -Infinity,
      descHit ? descHit.score : -Infinity,
    );

    ranked.push({
      command,
      score,
      idRanges: idHit?.ranges ?? [],
      descRanges: descHit?.ranges ?? [],
    });
  }

  return ranked
    .sort((a, b) => b.score - a.score || a.command.id.localeCompare(b.command.id))
    .slice(0, limit);
}
