import { searchAllManga } from "@kunai/providers";
import type { SearchResult, ShellMode, TitleAlias } from "@/domain/types";
import type { ProviderRegistry } from "@/services/providers/ProviderRegistry";

export type AnimeProviderMappingContext = {
  readonly mode: ShellMode;
  readonly providerId: string;
  readonly animeLanguageProfile: import("@/services/persistence/ConfigService").MediaLanguageProfile;
  readonly providerRegistry: ProviderRegistry;
  readonly signal?: AbortSignal;
};

const ALLMANGA_API_URL = "https://api.allanime.day/api";
const ALLMANGA_REFERER = "https://allmanga.to";
const ALLMANGA_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0";

export async function mapAnimeDiscoveryResultToProviderNative(
  result: SearchResult,
  context: AnimeProviderMappingContext,
): Promise<SearchResult> {
  if (context.mode !== "anime" || result.metadataSource !== "AniList trending") {
    return result;
  }

  if (context.providerId !== "allanime") return result;

  const animeLang =
    context.animeLanguageProfile.audio === "ja" ||
    context.animeLanguageProfile.audio === "original"
      ? "sub"
      : "dub";

  for (const query of providerSearchQueries(result)) {
    const providerResults = await searchAllManga(
      ALLMANGA_API_URL,
      ALLMANGA_REFERER,
      ALLMANGA_UA,
      query,
      animeLang as "sub" | "dub",
    ).catch(() => []);

    const mapped: SearchResult[] = providerResults.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      year: r.year ?? "",
      overview: "",
      posterPath: r.posterUrl ?? null,
      rating: null,
      popularity: null,
      episodeCount: r.epCount,
      availableAudioModes: r.availableAudioModes,
      subtitleAvailability: r.availableAudioModes?.includes("sub")
        ? ("hardsub" as const)
        : ("unknown" as const),
    }));

    const match = chooseProviderSearchMatch(result, mapped);
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
