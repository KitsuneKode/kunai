import type { SearchResult, ShellMode } from "@/domain/types";
import {
  createCatalogDiscoveryService,
  type CatalogDiscoveryLoaders,
} from "@/services/catalog/CatalogDiscoveryService";

const discoveryService = createCatalogDiscoveryService();

export function clearDiscoveryListCache(): void {
  discoveryService.clearTrendingCache();
}

export async function loadDiscoveryList(
  mode: ShellMode,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  return discoveryService.loadTrending(mode, signal);
}

export async function loadSurpriseList(
  mode: ShellMode,
  signal?: AbortSignal,
  testLoaders?: {
    readonly random?: () => number;
    readonly anime?: CatalogDiscoveryLoaders["animeSurprise"];
    readonly tmdb?: CatalogDiscoveryLoaders["tmdbSurprise"];
  },
): Promise<SearchResult[]> {
  if (testLoaders) {
    const service = createCatalogDiscoveryService({
      anime: async () => [],
      tmdb: async () => [],
      animeSurprise: testLoaders.anime,
      tmdbSurprise: testLoaders.tmdb,
    });
    return service.loadSurprise(mode, signal, { random: testLoaders.random ?? Math.random });
  }
  return discoveryService.loadSurprise(mode, signal);
}
