import { formatRelativeAge } from "@/domain/relative-age";
import type { SearchResult, ShellMode } from "@/domain/types";
import {
  createCatalogDiscoveryService,
  type CatalogDiscoveryLoaders,
  type CatalogTrendingSection,
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

const TRENDING_SOURCE_LABELS = new Map<string, string>([
  ["anilist", "AniList"],
  ["kitsu", "Kitsu"],
  ["jikan", "MyAnimeList"],
  ["tmdb", "TMDB"],
  ["youtube", "YouTube"],
]);

/**
 * Where a trending list came from, for subtitles: the source that actually
 * answered (Kitsu when AniList was down), or the saved list and its age.
 */
export function describeTrendingSource(
  section: Pick<CatalogTrendingSection, "sourceId" | "staleSince">,
  now: number = Date.now(),
): string {
  if (section.staleSince !== undefined) {
    const age = formatRelativeAge(section.staleSince, now);
    return age ? `saved list · updated ${age}` : "saved list";
  }
  return TRENDING_SOURCE_LABELS.get(section.sourceId) ?? section.sourceId;
}

/** Trending plus its source and, when every live source failed, its age. */
export async function loadDiscoverySection(
  mode: ShellMode,
  signal?: AbortSignal,
): Promise<CatalogTrendingSection> {
  return discoveryService.loadTrendingSection(mode, signal);
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
