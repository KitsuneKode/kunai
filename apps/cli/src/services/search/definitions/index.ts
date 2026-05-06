// =============================================================================
// Search Service Definitions Registry
//
// Export all search service definitions.
// =============================================================================

import type { SearchServiceDefinition } from "../SearchService";
import { createTMDBSearchService } from "./tmdb";

export const SEARCH_SERVICE_DEFINITIONS: SearchServiceDefinition[] = [
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
