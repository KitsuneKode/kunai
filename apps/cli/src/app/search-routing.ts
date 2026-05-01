import type { SearchResult, ShellMode } from "../domain/types";
import type { SearchRegistry } from "../services/search/SearchRegistry";
import type { ProviderRegistry } from "../services/providers/ProviderRegistry";

export type SearchRoutingContext = {
  mode: ShellMode;
  providerId: string;
  animeLang: "sub" | "dub";
  signal?: AbortSignal;
  searchRegistry: Pick<SearchRegistry, "getDefault" | "getForProvider">;
  providerRegistry: ProviderRegistry;
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
        animeLang: context.animeLang,
      },
      context.signal,
    );

    if (results) {
      return {
        results: results.map(normalizeProviderSearchResult),
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
    year: candidate.year ?? "",
    overview: candidate.overview ?? "",
    posterPath: candidate.posterPath ?? null,
    rating: candidate.rating ?? null,
    popularity: candidate.popularity ?? null,
    episodeCount: candidate.episodeCount ?? candidate.epCount,
  };
}
