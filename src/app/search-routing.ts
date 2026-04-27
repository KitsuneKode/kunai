import type { SearchResult, ShellMode } from "../domain/types";
import type { SearchRegistry } from "../services/search/SearchRegistry";
import type { ProviderRegistry } from "../services/providers/ProviderRegistry";
import type { Provider } from "../services/providers/Provider";

export type SearchRoutingContext = {
  mode: ShellMode;
  providerId: string;
  animeLang: "sub" | "dub";
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
    const results = await provider.search(query, {
      animeLang: context.animeLang,
    });

    if (results) {
      return {
        results,
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
    results: await searchService.search(query),
    sourceId: searchService.metadata.id,
    sourceName: searchService.metadata.name,
    strategy: "registry",
  };
}
