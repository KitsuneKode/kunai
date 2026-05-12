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
};

export async function searchTitles(
  query: string,
  context: SearchRoutingContext,
): Promise<SearchRoutingResult> {
  const provider = context.providerRegistry.get(context.providerId);

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
      };
    }
  }

  const searchService =
    context.searchRegistry.getForProvider(context.providerId) ??
    context.searchRegistry.getDefault();

  return {
    results: await searchService.search(query, context.signal),
    sourceId: searchService.metadata.id,
    sourceName: searchService.metadata.name,
    strategy: "registry",
  };
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
