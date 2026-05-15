import type { SearchResult, ShellMode, TitleAlias } from "@/domain/types";
import type { ProviderRegistry } from "@/services/providers/ProviderRegistry";
import { searchAllManga, type AllMangaSearchResult } from "@kunai/providers";

export type AnimeProviderMappingContext = {
  readonly mode: ShellMode;
  readonly providerId: string;
  readonly animeLanguageProfile: import("@/services/persistence/ConfigService").MediaLanguageProfile;
  readonly providerRegistry: ProviderRegistry;
  readonly signal?: AbortSignal;
};

const ALLMANGA_API_URL = "https://api.allanime.day/api";
const ALLMANGA_REFERER = "https://youtu-chan.com";
const ALLMANGA_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0";

export async function mapAnimeDiscoveryResultToProviderNative(
  result: SearchResult,
  context: AnimeProviderMappingContext,
): Promise<SearchResult> {
  if (context.mode !== "anime" || !isAniListBackedResult(result)) {
    return result;
  }

  const discoveryAniListId = parseInt(result.id, 10);
  const provider = context.providerRegistry.get(context.providerId);

  // Tier 1: Direct AniList ID match via API (fast, accurate)
  if (!isNaN(discoveryAniListId)) {
    const animeLang =
      context.animeLanguageProfile.audio === "ja" ||
      context.animeLanguageProfile.audio === "original"
        ? ("sub" as const)
        : ("dub" as const);
    for (const query of providerSearchQueries(result)) {
      const matches = await searchAllManga(
        ALLMANGA_API_URL,
        ALLMANGA_REFERER,
        ALLMANGA_UA,
        query,
        animeLang,
      ).catch(() => []);
      const idMatch = matches.find((r) => r.aniListId === discoveryAniListId);
      if (idMatch) return mergeAniListDiscoveryWithProviderResult(result, idMatch);
      const titleMatch = chooseProviderSearchMatch(result, matches);
      if (titleMatch) return mergeAniListDiscoveryWithProviderResult(result, titleMatch);
    }
  }

  // Tier 2: Title-based match via provider search (testable via mock)
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

    if (!providerResults?.length) continue;

    // Try numeric ID match on provider results
    if (!isNaN(discoveryAniListId)) {
      const idMatch = providerResults.find((r) => r.id === discoveryAniListId.toString());
      if (idMatch) return result;
    }

    const match = chooseProviderSearchMatch(result, providerResults.map(toAllMangaResult));
    if (match) return mergeAniListDiscoveryWithProviderResult(result, match);
  }

  return result;
}

function isAniListBackedResult(result: SearchResult): boolean {
  return result.metadataSource?.startsWith("AniList ") === true;
}

function toAllMangaResult(r: SearchResult): AllMangaSearchResult {
  return {
    id: r.id,
    title: r.title,
    type: "series",
    year: r.year || undefined,
    posterUrl: r.posterPath ?? undefined,
    description: r.overview || undefined,
    epCount: r.episodeCount,
    englishTitle: r.titleAliases?.find((a) => a.kind === "english")?.value,
    nativeTitle: r.titleAliases?.find((a) => a.kind === "native")?.value,
    altNames: r.titleAliases?.filter((a) => a.kind === "synonym").map((a) => a.value),
  };
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
  providerResults: readonly AllMangaSearchResult[],
): AllMangaSearchResult | null {
  let best: { result: AllMangaSearchResult; score: number } | null = null;
  for (const candidate of providerResults) {
    const score = titleMatchScore(discovery, candidate);
    if (score <= 0) continue;
    if (!best || score > best.score) best = { result: candidate, score };
  }
  return best?.result ?? null;
}

function titleMatchScore(discovery: SearchResult, candidate: AllMangaSearchResult): number {
  const discoveryNames = titleNames(discovery).map(normalizeTitle).filter(Boolean);
  const candidateNames = candidateTitleNames(candidate).map(normalizeTitle).filter(Boolean);
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
  providerResult: AllMangaSearchResult,
): SearchResult {
  return {
    ...discovery,
    id: providerResult.id,
    title: providerResult.title || discovery.title,
    titleAliases: mergeTitleAliases(discovery.titleAliases, [
      { kind: "provider", value: providerResult.title },
      ...(providerResult.englishTitle
        ? [{ kind: "english" as const, value: providerResult.englishTitle }]
        : []),
      ...(providerResult.nativeTitle
        ? [{ kind: "native" as const, value: providerResult.nativeTitle }]
        : []),
      ...(providerResult.altNames ?? [])
        .slice(0, 3)
        .map((v: string) => ({ kind: "synonym" as const, value: v })),
    ]),
    year: discovery.year || (providerResult.year ?? ""),
    overview: discovery.overview || (providerResult.description ?? ""),
    posterPath: discovery.posterPath ?? providerResult.posterUrl ?? null,
    posterSource: discovery.posterPath
      ? discovery.posterSource
      : providerResult.posterUrl
        ? "AllManga"
        : undefined,
    metadataSource: `${discovery.metadataSource} + allanime search`,
    episodeCount: providerResult.epCount ?? discovery.episodeCount,
  };
}

function candidateTitleNames(candidate: AllMangaSearchResult): readonly string[] {
  return [
    candidate.title,
    candidate.englishTitle,
    candidate.nativeTitle,
    ...(candidate.altNames ?? []),
  ].filter((value): value is string => Boolean(value));
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
