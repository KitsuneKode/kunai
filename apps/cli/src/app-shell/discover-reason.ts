import type { RecommendationSection } from "@/services/recommendations/RecommendationService";

/** Short section header (list group title). */
export function discoverSectionHeaderTitle(section: RecommendationSection): string {
  switch (section.reason) {
    case "similar":
      return "Similar picks";
    case "trending":
      return "Trending now";
    case "genre-affinity":
      return "For your taste";
    default:
      return "Discover";
  }
}

/** Emphasized reason line under the header (the human “why”). */
export function discoverSectionReasonLine(section: RecommendationSection): string {
  if (section.label.trim().length > 0) {
    return section.label;
  }
  switch (section.reason) {
    case "similar":
      return "Because of your recent watch";
    case "trending":
      return "Trending this week";
    case "genre-affinity":
      return "Matches your watch pattern";
    default:
      return "Curated for you";
  }
}

/** Dim subtitle under the emphasized reason line. */
export function discoverSectionReasonDetail(section: RecommendationSection): string {
  switch (section.reason) {
    case "similar":
      return "Similar titles from TMDB";
    case "trending":
      return "Popular picks this week";
    case "genre-affinity":
      return "Weighted by genres you watch most";
    default:
      return "Recommendations";
  }
}
