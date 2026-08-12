import type { SearchResult, ShellMode, TitleAlias } from "@/domain/types";
import type { ProviderRegistry } from "@/services/providers/ProviderRegistry";
import { mergeProviderNativeId } from "@kunai/core";
import { looksLikeAnidbShowId, searchAllManga, type AllMangaSearchResult } from "@kunai/providers";
import type { ProviderId } from "@kunai/types";

export type AnimeProviderMappingContext = {
  readonly mode: ShellMode;
  readonly providerId: string;
  readonly animeLanguageProfile: import("@/services/persistence/ConfigService").MediaLanguageProfile;
  readonly providerRegistry: ProviderRegistry;
  readonly signal?: AbortSignal;
  readonly searchProviderNative?: typeof searchAllManga;
  readonly persistProviderNative?: (nativeId: string) => void;
};

const ALLMANGA_API_URL = "https://api.allanime.day/api";
const ALLMANGA_REFERER = "https://youtu-chan.com";
const ALLMANGA_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0";

export async function mapAnimeDiscoveryResultToProviderNative(
  result: SearchResult,
  context: AnimeProviderMappingContext,
): Promise<SearchResult> {
  if (context.mode !== "anime") {
    return result;
  }

  if (looksLikeProviderNativeSearchId(result)) {
    return result;
  }

  const storedNative = result.externalIds?.providerNativeIds?.[context.providerId as ProviderId];
  if (storedNative) {
    return { ...result, id: storedNative };
  }

  const provider = context.providerRegistry.get(context.providerId);
  if (provider?.metadata.catalogIdentity === "anilist") {
    return ensureAniListDiscoveryExternalIds(result);
  }

  if (!shouldRemapDiscoveryToProviderNative(result)) {
    return result;
  }

  const discoveryAniListId = parseInt(result.id, 10);
  const searchProviderNative = context.searchProviderNative ?? searchAllManga;

  // Tier 1: Direct AniList ID match via the AllManga API. This returns AllAnime
  // opaque ids, so it may only ever populate the allanime id slot — writing one
  // into another provider's slot pins an id that provider cannot resolve.
  if (context.providerId === "allanime" && !Number.isNaN(discoveryAniListId)) {
    const animeLang =
      context.animeLanguageProfile.audio === "ja" ||
      context.animeLanguageProfile.audio === "original"
        ? ("sub" as const)
        : ("dub" as const);
    for (const query of providerSearchQueries(result)) {
      const matches = await searchProviderNative(
        { providerId: "allanime", now: () => new Date().toISOString(), signal: context.signal },
        ALLMANGA_API_URL,
        ALLMANGA_REFERER,
        ALLMANGA_UA,
        query,
        animeLang,
        context.signal,
      ).catch(() => []);
      const match =
        matches.find((candidate) => candidate.aniListId === discoveryAniListId) ??
        chooseProviderSearchMatch(result, matches);
      if (match) {
        return mergeAniListDiscoveryWithProviderResult(result, match, "allanime", context);
      }
    }
  }

  // Tier 2: Title-based match via the active provider's own search. Every match
  // must be an id the active provider actually owns, otherwise we fail closed to
  // catalog identity rather than pinning a foreign id.
  if (!provider?.search) return ensureAniListDiscoveryExternalIds(result);

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

    const owned = providerResults.filter((candidate) =>
      isValidProviderNativeId(context.providerId, candidate.id),
    );
    if (owned.length === 0) continue;

    // Try numeric ID match on provider results
    if (!isNaN(discoveryAniListId)) {
      const idMatch = owned.find((r) => r.id === discoveryAniListId.toString());
      if (idMatch) {
        return mergeAniListDiscoveryWithProviderResult(
          result,
          toAllMangaResult(idMatch),
          context.providerId,
          context,
        );
      }
    }

    const match = chooseProviderSearchMatch(result, owned.map(toAllMangaResult));
    if (match)
      return mergeAniListDiscoveryWithProviderResult(result, match, context.providerId, context);
  }

  return ensureAniListDiscoveryExternalIds(result);
}

/**
 * Does `id` belong to `providerId`'s own id space? Fail closed: a provider-native
 * id slot must never receive another catalog's id, because resolve trusts it.
 */
function isValidProviderNativeId(providerId: string, id: string): boolean {
  const trimmed = id.trim();
  if (!trimmed) return false;
  if (providerId === "anidb") return looksLikeAnidbShowId(trimmed);
  if (providerId === "allanime") return !/^\d+$/.test(trimmed);
  return true;
}

function shouldRemapDiscoveryToProviderNative(result: SearchResult): boolean {
  if (result.externalIds?.anilistId) return true;
  return isAniListBackedResult(result);
}

function looksLikeProviderNativeSearchId(result: SearchResult): boolean {
  const anilistId = result.externalIds?.anilistId;
  if (anilistId && result.id === anilistId) return false;
  if (/^\d+$/.test(result.id)) return false;
  return result.id.trim().length > 0;
}

function isAniListBackedResult(result: SearchResult): boolean {
  if (result.metadataSource?.startsWith("AniList") === true) return true;
  if (/^\d+$/.test(result.id) && result.metadataSource?.toLowerCase().includes("anilist")) {
    return true;
  }
  return false;
}

function ensureAniListDiscoveryExternalIds(result: SearchResult): SearchResult {
  const discoveryAniListId = parseInt(result.id, 10);
  if (Number.isNaN(discoveryAniListId) || result.externalIds?.anilistId) {
    return result;
  }
  return {
    ...result,
    externalIds: {
      ...result.externalIds,
      anilistId: String(discoveryAniListId),
    },
  };
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
  providerId: string,
  context: AnimeProviderMappingContext,
): SearchResult {
  const discoveryAniListId = parseInt(discovery.id, 10);
  const catalogIds = {
    ...discovery.externalIds,
    anilistId:
      discovery.externalIds?.anilistId ??
      (!Number.isNaN(discoveryAniListId) ? String(discoveryAniListId) : undefined),
    malId:
      providerResult.malId !== undefined
        ? String(providerResult.malId)
        : discovery.externalIds?.malId,
  };
  const externalIds = mergeProviderNativeId(catalogIds, providerId, providerResult.id);
  context.persistProviderNative?.(providerResult.id);

  return {
    ...discovery,
    id: providerResult.id,
    externalIds: externalIds ?? discovery.externalIds,
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
        ? providerId
        : undefined,
    // Name the provider that actually supplied the identity; this string is
    // surfaced to the user as "Metadata source".
    metadataSource: `${discovery.metadataSource} + ${providerId} search`,
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
