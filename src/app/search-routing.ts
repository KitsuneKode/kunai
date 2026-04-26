import {
  getProvider,
  isApi,
  type ApiProvider,
  type ApiSearchResult,
  type Provider,
} from "../providers";
import type { SearchResult, ShellMode } from "../domain/types";
import type { SearchRegistry } from "../services/search/SearchRegistry";

export type SearchRoutingContext = {
  mode: ShellMode;
  providerId: string;
  animeLang: "sub" | "dub";
  searchRegistry: Pick<SearchRegistry, "getDefault" | "getForProvider">;
  lookupProvider?: (providerId: string) => Provider;
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
  const provider = (context.lookupProvider ?? getProvider)(context.providerId);

  if (shouldUseProviderNativeSearch(context.mode, provider)) {
    const results = await provider.search(query, {
      animeLang: context.animeLang,
    });

    return {
      results: results.map(mapApiSearchResult),
      sourceId: provider.id,
      sourceName: provider.name,
      strategy: "provider-native",
    };
  }

  const searchService =
    context.searchRegistry.getForProvider(context.providerId) ??
    context.searchRegistry.getDefault();

  return {
    results: await searchService.search(query),
    sourceId: searchService.metadata.id,
    sourceName: searchService.metadata.name,
    strategy: "registry",
  };
}

function shouldUseProviderNativeSearch(
  mode: ShellMode,
  provider: Provider,
): provider is ApiProvider {
  return mode === "anime" && isApi(provider) && provider.isAnimeProvider === true;
}

function mapApiSearchResult(result: ApiSearchResult): SearchResult {
  return {
    id: result.id,
    type: result.type,
    title: result.title,
    year: result.year ?? "",
    overview: "",
    posterPath: result.posterUrl ?? null,
    rating: null,
    popularity: null,
    episodeCount: result.epCount,
  };
}
