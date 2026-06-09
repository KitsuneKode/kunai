// =============================================================================
// RecommendationService Interface (Domain)
//
// Contract for fetching TMDB-backed recommendation sections.
// =============================================================================

import type { ContentType, SearchResult } from "@/domain/types";

export interface RecommendationHistorySeed {
  readonly title: string;
  readonly type: ContentType;
  /** Catalog id from watch history (TMDB numeric id for series/movie paths). */
  readonly titleId?: string;
  readonly watchedAt: string;
}

export interface RecommendationSection {
  readonly label: string;
  readonly reason: "similar" | "trending" | "genre-affinity";
  readonly items: readonly SearchResult[];
}

export interface RecommendationService {
  /** Clears persisted recommendation cache so the next request fetches fresh catalog data. */
  clearCache(): Promise<void>;
  /** TMDB /recommendations for a specific title. Cached 24 h. */
  getForTitle(tmdbId: string, type: ContentType): Promise<RecommendationSection>;
  /** TMDB /trending/all/week. Cached 6 h. */
  getTrending(): Promise<RecommendationSection>;
  /**
   * History-driven recommendations via TMDB discover + weighted genre profile.
   * Returns an empty section when history is insufficient or upstream calls fail.
   */
  getPersonalizedByHistory(
    historyEntries: readonly RecommendationHistorySeed[],
  ): Promise<RecommendationSection>;
  /** Top-rated titles in the user's most-watched genres. Cached 24 h. */
  getGenreAffinity(topGenreIds: number[]): Promise<RecommendationSection>;
}
