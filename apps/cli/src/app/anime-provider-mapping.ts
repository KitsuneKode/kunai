import type { SearchResult, ShellMode, TitleAlias } from "@/domain/types";
import type { ProviderRegistry } from "@/services/providers/ProviderRegistry";

export type AnimeProviderMappingContext = {
  readonly mode: ShellMode;
  readonly providerId: string;
  readonly animeLanguageProfile: import("@/services/persistence/ConfigService").MediaLanguageProfile;
  readonly providerRegistry: ProviderRegistry;
  readonly signal?: AbortSignal;
};

export async function mapAnimeDiscoveryResultToProviderNative(
  result: SearchResult,
  context: AnimeProviderMappingContext,
): Promise<SearchResult> {
  if (context.mode !== "anime" || result.metadataSource !== "AniList trending") {
    return result;
  }

  const provider = context.providerRegistry.get(context.providerId);
  if (!provider?.search) return result;

  for (const query of providerSearchQueries(result)) {
    const providerResults = await provider
      .search(
        query,
        {
          audioPreference: context.animeLanguageProfile.audio,
          subtitlePreference: context.animeLanguageProfile.subtitle,
        },
        context.signal,
      )
      .catch(() => null);
    const match = chooseProviderSearchMatch(result, providerResults ?? []);
    if (match) return mergeAniListDiscoveryWithProviderResult(result, match);
  }

  return result;
}

function providerSearchQueries(result: SearchResult): readonly string[] {
  const preferredKinds = ["provider", "english", "romaji", "synonym", "native"] as const;
  const values = [
    result.title,
    ...preferredKinds.flatMap((kind) =>
      (result.titleAliases ?? [])
        .filter((alias) => alias.kind === kind)
        .map((alias) => alias.value),
    ),
  ];
  return uniqueNormalized(values).slice(0, 5);
}

function chooseProviderSearchMatch(
  discovery: SearchResult,
  providerResults: readonly SearchResult[],
): SearchResult | null {
  let best: { result: SearchResult; score: number } | null = null;
  for (const candidate of providerResults) {
    const score = titleMatchScore(discovery, candidate);
    if (score <= 0) continue;
    if (!best || score > best.score) best = { result: candidate, score };
  }
  return best?.result ?? null;
}

function titleMatchScore(discovery: SearchResult, candidate: SearchResult): number {
  const discoveryNames = titleNames(discovery).map(normalizeTitle).filter(Boolean);
  const candidateNames = titleNames(candidate).map(normalizeTitle).filter(Boolean);
  let score = 0;
  for (const left of discoveryNames) {
    for (const right of candidateNames) {
      if (left === right) score = Math.max(score, 100);
      else if (left.includes(right) || right.includes(left)) score = Math.max(score, 60);
    }
  }
  if (score > 0 && discovery.year && candidate.year && discovery.year === candidate.year) {
    score += 5;
  }
  return score;
}

function mergeAniListDiscoveryWithProviderResult(
  discovery: SearchResult,
  providerResult: SearchResult,
): SearchResult {
  return {
    ...discovery,
    id: providerResult.id,
    title: providerResult.title || discovery.title,
    titleAliases: mergeTitleAliases(discovery.titleAliases, [
      { kind: "provider", value: providerResult.title },
      ...(providerResult.titleAliases ?? []),
    ]),
    year: discovery.year || providerResult.year,
    overview: discovery.overview || providerResult.overview,
    posterPath: discovery.posterPath ?? providerResult.posterPath,
    posterSource: discovery.posterPath ? discovery.posterSource : providerResult.posterSource,
    metadataSource: `${discovery.metadataSource} + provider search`,
    episodeCount: providerResult.episodeCount ?? discovery.episodeCount,
  };
}

function titleNames(result: SearchResult): readonly string[] {
  return [result.title, ...(result.titleAliases ?? []).map((alias) => alias.value)];
}

function mergeTitleAliases(
  current: readonly TitleAlias[] | undefined,
  next: readonly TitleAlias[],
): readonly TitleAlias[] {
  const merged: TitleAlias[] = [];
  const seen = new Set<string>();
  for (const alias of [...(current ?? []), ...next]) {
    if (!alias.value) continue;
    const key = `${alias.kind}:${normalizeTitle(alias.value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(alias);
  }
  return merged;
}

function uniqueNormalized(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = normalizeTitle(trimmed);
    if (!trimmed || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
