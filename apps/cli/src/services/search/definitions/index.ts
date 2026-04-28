// =============================================================================
// Search Service Definitions Registry
//
// Export all search service definitions.
// =============================================================================

import type { SearchServiceDefinition } from "../SearchService";
import { createTMDBSearchService } from "./tmdb";
import { createHiAnimeSearchService } from "./hianime";

export const SEARCH_SERVICE_DEFINITIONS: SearchServiceDefinition[] = [
  {
    id: "tmdb",
    metadata: {
      id: "tmdb",
      name: "TMDB / Videasy",
      description: "TMDB proxy (db.videasy.net) - movies, series, no API key",
    },
    compatibleProviders: ["vidking", "cineby", "bitcine", "braflix"],
    factory: createTMDBSearchService,
  },
  {
    id: "hianime",
    metadata: {
      id: "hianime",
      name: "HiAnime (Cineby Anime)",
      description: "HiAnime search (anime-db.videasy.net)",
    },
    compatibleProviders: ["cineby-anime"],
    factory: createHiAnimeSearchService,
  },
];
