import {
  normalizeSearchIntent,
  type SearchIntent,
  type SearchIntentFilters,
} from "../domain/search/SearchIntent";
import { describeSearchIntentFilters } from "../domain/search/SearchIntentParser";
import type { SearchResult, ShellMode } from "../domain/types";
import type { ProviderRegistry } from "../services/providers/ProviderRegistry";
import type { SearchRegistry } from "../services/search/SearchRegistry";
import { enrichAnimeSearchResultsWithAniList } from "./anime-metadata";

export type SearchRoutingContext = {
  mode: ShellMode;
  providerId: string;
  animeLanguageProfile: import("../services/persistence/ConfigService").MediaLanguageProfile;
  signal?: AbortSignal;
  searchRegistry: Pick<SearchRegistry, "getDefault" | "getForProvider">;
  providerRegistry: ProviderRegistry;
  enrichAnimeMetadata?: boolean;
};

export type SearchRoutingResult = {
  results: SearchResult[];
  sourceId: string;
  sourceName: string;
  strategy: "provider-native" | "registry";
  evidence: SearchFilterEvidence;
};

export type SearchFilterEvidence = {
  upstream: string[];
  local: string[];
  unsupported: string[];
};

export async function searchTitles(
  input: string | SearchIntent,
  context: SearchRoutingContext,
): Promise<SearchRoutingResult> {
  const intent = typeof input === "string" ? normalizeSearchInput(input, context.mode) : input;
  const query = intent.query;
  const provider = context.providerRegistry.get(context.providerId);
  const advanced = hasAdvancedSearchFilters(intent);

  if (advanced) {
    const searchService =
      context.searchRegistry.getForProvider(context.providerId) ??
      context.searchRegistry.getDefault();
    const evidence = classifySearchEvidence(intent, searchService.metadata.id);
    const results = applyLocalSearchFilters(
      await searchService.search(query, context.signal, intent),
      intent,
      evidence,
    );

    return {
      results,
      sourceId: searchService.metadata.id,
      sourceName: searchService.metadata.name,
      strategy: "registry",
      evidence,
    };
  }

  if (provider && context.mode === "anime" && provider.search) {
    const results = await provider.search(
      query,
      {
        audioPreference: context.animeLanguageProfile.audio,
        subtitlePreference: context.animeLanguageProfile.subtitle,
      },
      context.signal,
    );

    if (results) {
      const normalized = results.map(normalizeProviderSearchResult);

      // Skip AniList enrichment when provider already supplied rich metadata.
      const hasNativeMetadata = normalized.some(
        (r) => r.posterPath && r.metadataSource === "AniList",
      );
      const enriched =
        context.enrichAnimeMetadata === false || hasNativeMetadata
          ? normalized
          : await enrichAnimeSearchResultsWithAniList(query, normalized, context.signal);

      return {
        results: enriched,
        sourceId: provider.metadata.id,
        sourceName: provider.metadata.name,
        strategy: "provider-native",
        evidence: classifySearchEvidence(intent, provider.metadata.id),
      };
    }
  }

  const searchService =
    context.searchRegistry.getForProvider(context.providerId) ??
    context.searchRegistry.getDefault();

  const evidence = classifySearchEvidence(intent, searchService.metadata.id);
  const results = applyLocalSearchFilters(
    await searchService.search(query, context.signal, intent),
    intent,
    evidence,
  );

  return {
    results,
    sourceId: searchService.metadata.id,
    sourceName: searchService.metadata.name,
    strategy: "registry",
    evidence,
  };
}

function normalizeSearchInput(query: string, mode: ShellMode): SearchIntent {
  return normalizeSearchIntent({
    query,
    mode,
    filters: {},
    sort: "relevance",
  });
}

function hasAdvancedSearchFilters(intent: SearchIntent): boolean {
  return (
    intent.query.trim().length === 0 ||
    Boolean(
      intent.filters.type ||
      intent.filters.genres?.length ||
      typeof intent.filters.minRating === "number" ||
      intent.filters.year ||
      intent.filters.provider ||
      typeof intent.filters.downloaded === "boolean" ||
      intent.filters.watched ||
      intent.filters.release ||
      intent.sort !== "relevance",
    )
  );
}

function classifySearchEvidence(intent: SearchIntent, sourceId: string): SearchFilterEvidence {
  const labels = describeSearchIntentFilters({
    mode: intent.mode === "all" ? undefined : intent.mode,
    filters: intent.filters,
    sort: intent.sort,
  });
  if (labels.length === 0) return { upstream: [], local: [], unsupported: [] };

  const upstreamKeys = getUpstreamFilterKeys(intent, sourceId);
  const localKeys = getLocalFilterKeys(intent, sourceId);
  const unsupportedKeys = getUnsupportedFilterKeys(intent, sourceId);

  return {
    upstream: labels.filter((label) => matchesEvidenceKey(label, upstreamKeys)),
    local: labels.filter((label) => matchesEvidenceKey(label, localKeys)),
    unsupported: labels.filter((label) => matchesEvidenceKey(label, unsupportedKeys)),
  };
}

function getUpstreamFilterKeys(intent: SearchIntent, sourceId: string): readonly string[] {
  if (sourceId === "tmdb" && intent.query.trim().length > 0) return [];
  if (sourceId !== "tmdb" && sourceId !== "anilist") return [];
  return [
    intent.filters.type && sourceId === "tmdb" ? "type" : null,
    intent.filters.genres?.length ? "genre" : null,
    typeof intent.filters.minRating === "number" ? "rating" : null,
    intent.filters.year && sourceId === "tmdb" ? "year" : null,
    intent.filters.year && sourceId === "anilist" && typeof intent.filters.year === "number"
      ? "year"
      : null,
    intent.sort !== "relevance" && intent.sort !== "progress" ? "sort" : null,
  ].filter((value): value is string => Boolean(value));
}

function getLocalFilterKeys(intent: SearchIntent, sourceId: string): readonly string[] {
  if (sourceId === "tmdb" && intent.query.trim().length > 0) {
    return [
      intent.filters.type ? "type" : null,
      typeof intent.filters.minRating === "number" ? "rating" : null,
      intent.filters.year ? "year" : null,
      intent.sort === "rating" || intent.sort === "popular" || intent.sort === "recent"
        ? "sort"
        : null,
    ].filter((value): value is string => Boolean(value));
  }
  if (sourceId === "tmdb" || sourceId === "anilist") return [];
  return [
    intent.filters.type ? "type" : null,
    typeof intent.filters.minRating === "number" ? "rating" : null,
    intent.filters.year ? "year" : null,
  ].filter((value): value is string => Boolean(value));
}

function getUnsupportedFilterKeys(intent: SearchIntent, sourceId: string): readonly string[] {
  const { filters } = intent;
  return [
    sourceId === "tmdb" && intent.query.trim().length > 0 && filters.genres?.length
      ? "genre"
      : null,
    filters.provider ? "provider" : null,
    typeof filters.downloaded === "boolean" ? "downloaded" : null,
    filters.watched ? "watched" : null,
    filters.release ? "release" : null,
  ].filter((value): value is string => Boolean(value));
}

function applyLocalSearchFilters(
  results: SearchResult[],
  intent: SearchIntent,
  evidence: SearchFilterEvidence,
): SearchResult[] {
  const localKeys = new Set(evidence.local.map((badge) => badge.split(" ")[0]).filter(Boolean));
  let filtered = results;
  if (localKeys.has("type") && intent.filters.type && intent.filters.type !== "all") {
    filtered = filtered.filter((result) => result.type === intent.filters.type);
  }
  if (localKeys.has("rating") && typeof intent.filters.minRating === "number") {
    const minRating = intent.filters.minRating;
    filtered = filtered.filter(
      (result) => typeof result.rating === "number" && result.rating >= minRating,
    );
  }
  if (localKeys.has("year") && intent.filters.year) {
    filtered = filtered.filter((result) => matchesYear(result.year, intent.filters.year));
  }
  if (localKeys.has("sort")) {
    filtered = [...filtered].sort((left, right) => compareResultsBySort(left, right, intent.sort));
  }
  return filtered;
}

function matchesYear(year: string, filter: SearchIntentFilters["year"]): boolean {
  const parsed = Number.parseInt(year, 10);
  if (!Number.isFinite(parsed) || !filter) return false;
  if (typeof filter === "number") return parsed === filter;
  if (typeof filter.from === "number" && parsed < filter.from) return false;
  if (typeof filter.to === "number" && parsed > filter.to) return false;
  return true;
}

function compareResultsBySort(
  left: SearchResult,
  right: SearchResult,
  sort: SearchIntent["sort"],
): number {
  if (sort === "rating") return (right.rating ?? -1) - (left.rating ?? -1);
  if (sort === "popular") return (right.popularity ?? -1) - (left.popularity ?? -1);
  if (sort === "recent") return Number.parseInt(right.year, 10) - Number.parseInt(left.year, 10);
  return 0;
}

function matchesEvidenceKey(label: string, keys: readonly string[]): boolean {
  return keys.some((key) => label === key || label.startsWith(`${key} `));
}

function normalizeProviderSearchResult(result: SearchResult): SearchResult {
  const candidate = result as SearchResult & {
    epCount?: number;
    year?: string;
    overview?: string;
    posterPath?: string | null;
  };

  return {
    id: candidate.id,
    type: candidate.type,
    title: candidate.title,
    titleAliases: candidate.titleAliases,
    year: candidate.year ?? "",
    overview: candidate.overview ?? "",
    posterPath: candidate.posterPath ?? null,
    posterSource: candidate.posterSource,
    metadataSource: candidate.metadataSource,
    rating: candidate.rating ?? null,
    popularity: candidate.popularity ?? null,
    episodeCount: candidate.episodeCount ?? candidate.epCount,
  };
}
