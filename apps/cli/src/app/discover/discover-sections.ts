// =============================================================================
// Discover Sections Builder
//
// Single source of truth for the 3-section discover list composition.
// Used by both main.ts and PlaybackPhase.ts.
// =============================================================================

import { loadDiscoveryList } from "@/app/discover/discovery-lists";
import type { Container } from "@/container";
import {
  historyContentType,
  readLatestHistoryByTitle,
} from "@/services/continuation/history-progress";
import type { RecommendationSection } from "@/services/recommendations/RecommendationService";

export type DiscoverSectionsOptions = {
  /** Skip history-heavy personalized section (faster surfaces like /random). */
  readonly light?: boolean;
};

/**
 * Builds the full discover section list from history and TMDB/AniList.
 * Fetches in parallel; null sections (no history, no genres) are filtered out.
 */
export async function buildDiscoverSections(
  container: Pick<
    Container,
    "historyRepository" | "recommendationService" | "stateManager" | "providerRegistry"
  >,
  options: DiscoverSectionsOptions = {},
): Promise<readonly RecommendationSection[]> {
  const history = readLatestHistoryByTitle(container.historyRepository);
  const mode = container.stateManager.getState().mode;
  const animeProviders = new Set(
    container.providerRegistry
      .getAll()
      .filter((provider) => provider.metadata.isAnimeProvider)
      .map((provider) => provider.metadata.id),
  );

  const mostRecentCompleted = Object.entries(history)
    .filter(([, entry]) => entry.completed)
    .sort((a, b) => new Date(b[1].updatedAt).getTime() - new Date(a[1].updatedAt).getTime())[0];

  const topGenres: number[] = [];
  const recentHistoryId = mostRecentCompleted?.[0] ?? null;
  const hasTmdbLikeRecentId = recentHistoryId !== null && /^\d+$/.test(recentHistoryId);
  const completedHistorySeeds = Object.entries(history)
    .filter(([, entry]) => entry.completed)
    .filter(([, entry]) =>
      mode === "anime"
        ? animeProviders.has(entry.providerId ?? "unknown")
        : !animeProviders.has(entry.providerId ?? "unknown"),
    )
    .map(([titleId, entry]) => ({
      titleId,
      title: entry.title,
      type: historyContentType(entry),
      watchedAt: entry.updatedAt,
    }));

  const results = await Promise.all([
    !options.light && mostRecentCompleted && hasTmdbLikeRecentId
      ? container.recommendationService
          .getForTitle(recentHistoryId, historyContentType(mostRecentCompleted[1]))
          .then((s) => ({ ...s, label: `Because you watched ${mostRecentCompleted[1].title}` }))
      : null,
    loadDiscoveryList(mode).then((items) => ({
      label: mode === "anime" ? "Anime trending this week" : "Trending this week",
      reason: "trending" as const,
      items,
    })),
    !options.light && mode !== "anime" && completedHistorySeeds.length > 0
      ? container.recommendationService
          .getPersonalizedByHistory(completedHistorySeeds)
          .then((s) => ({ ...s, label: "From your watch pattern" }))
      : topGenres.length > 0
        ? container.recommendationService
            .getGenreAffinity(topGenres)
            .then((s) => ({ ...s, label: "From your watch pattern" }))
        : null,
  ]);

  return results.filter((s): s is RecommendationSection => s !== null);
}
