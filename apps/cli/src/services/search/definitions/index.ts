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
    servesCatalog: "anilist",
    // Provider-native adapters that still borrow the AniList catalog for
    // filtered search. AniList-identity providers (miruro) match via
    // servesCatalog and need no entry here.
    compatibleProviders: ["anidb", "allanime", "allmanga", "hianime"],
    factory: createAniListSearchService,
  },
  {
    id: "tmdb",
    metadata: {
      id: "tmdb",
      name: "TMDB / Videasy",
      description: "TMDB proxy (db.videasy.to) - movies, series, no API key",
    },
    // videasy, vidlink, rivestream and any future provider resolving TMDB ids
    // match via catalog identity — no list maintenance.
    servesCatalog: "tmdb",
    compatibleProviders: [],
    factory: createTMDBSearchService,
  },
];
