import type { SearchResult, ShellMode } from "@/domain/types";
import { createCatalogDiscoveryService } from "@/services/catalog/CatalogDiscoveryService";

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
