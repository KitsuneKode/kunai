// =============================================================================
// RecommendationService Interface (Domain)
//
// Contract for fetching TMDB-backed recommendation sections.
// =============================================================================

import type { ContentType, SearchResult } from "@/domain/types";

export interface RecommendationSection {
  readonly label: string;
  readonly reason: "similar" | "trending" | "genre-affinity";
  readonly items: readonly SearchResult[];
}

export interface RecommendationService {
  /** TMDB /recommendations for a specific title. Cached 24 h. */
  getForTitle(tmdbId: string, type: ContentType): Promise<RecommendationSection>;
  /** TMDB /trending/all/week. Cached 6 h. */
  getTrending(): Promise<RecommendationSection>;
  /** Top-rated titles in the user's most-watched genres. Cached 24 h. */
  getGenreAffinity(topGenreIds: number[]): Promise<RecommendationSection>;
}
