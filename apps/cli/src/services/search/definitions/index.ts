// =============================================================================
// Search Service Definitions Registry
//
// Export all search service definitions.
// =============================================================================

import type { SearchServiceDefinition } from "../SearchService";
import { createAniListSearchService } from "./anilist";
import { createTMDBSearchService } from "./tmdb";

export const SEARCH_SERVICE_DEFINITIONS: SearchServiceDefinition[] = [
  {
    id: "anilist",
    metadata: {
      id: "anilist",
      name: "AniList",
      description: "AniList GraphQL search and advanced anime discovery",
    },
    compatibleProviders: ["allanime", "allmanga", "miruro", "hianime"],
    factory: createAniListSearchService,
  },
  {
    id: "tmdb",
    metadata: {
      id: "tmdb",
      name: "TMDB / Videasy",
      description: "TMDB proxy (db.videasy.net) - movies, series, no API key",
    },
    compatibleProviders: ["vidking"],
    factory: createTMDBSearchService,
  },
];
