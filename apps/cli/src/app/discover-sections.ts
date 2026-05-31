// =============================================================================
// Discover Sections Builder
//
// Single source of truth for the 3-section discover list composition.
// Used by both main.ts and PlaybackPhase.ts.
// =============================================================================

import type { Container } from "@/container";
import { historyContentType } from "@/services/continuation/history-progress";
import type { RecommendationSection } from "@/services/recommendations/RecommendationService";

/**
 * Builds the full discover section list from history and TMDB.
 * Fetches in parallel; null sections (no history, no genres) are filtered out.
 */
export async function buildDiscoverSections(
  container: Pick<
    Container,
    "historyStore" | "recommendationService" | "stateManager" | "providerRegistry"
  >,
): Promise<readonly RecommendationSection[]> {
  const history = await container.historyStore.getAll();
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

  // SearchResult does not currently carry genreIds; genre affinity is skipped
  // until the field is added to the domain type.
  const topGenres: number[] = [];
  const recentHistoryId = mostRecentCompleted?.[0] ?? null;
  const hasTmdbLikeRecentId = recentHistoryId !== null && /^\d+$/.test(recentHistoryId);
  const completedHistorySeeds = Object.values(history)
    .filter((entry) => entry.completed)
    .filter((entry) =>
      mode === "anime"
        ? animeProviders.has(entry.providerId ?? "unknown")
        : !animeProviders.has(entry.providerId ?? "unknown"),
    )
    .map((entry) => ({
      title: entry.title,
      type: historyContentType(entry),
      watchedAt: entry.updatedAt,
    }));

  const results = await Promise.all([
    mostRecentCompleted && hasTmdbLikeRecentId
      ? container.recommendationService
          .getForTitle(recentHistoryId, historyContentType(mostRecentCompleted[1]))
          .then((s) => ({ ...s, label: `Because you watched ${mostRecentCompleted[1].title}` }))
      : null,
    mode === "anime"
      ? container.recommendationService
          .getGenreAffinity([16])
          .then((s) => ({ ...s, label: "Anime picks this week" }))
      : container.recommendationService
          .getTrending()
          .then((s) => ({ ...s, label: "Trending this week" })),
    completedHistorySeeds.length > 0
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
