// =============================================================================
// TMDB Search Service Adapter
//
// Wraps the Videasy-backed TMDB search helper into the SearchService interface.
// =============================================================================

import type { SearchResult, TitleInfo, SearchMetadata } from "@/domain/types";
import { discoverVideasy, searchVideasy } from "@/search";

import type { SearchService, SearchDeps } from "../SearchService";

export class TMDBSearchService implements SearchService {
  readonly metadata: SearchMetadata = {
    id: "tmdb",
    name: "TMDB / Videasy",
    description: "TMDB proxy (db.videasy.net) - movies, series, no API key",
  };

  readonly compatibleProviders = ["vidking"];

  constructor(private deps: SearchDeps) {}

  async search(
    query: string,
    signal?: AbortSignal,
    intent?: import("@/domain/search/SearchIntent").SearchIntent,
  ): Promise<SearchResult[]> {
    this.deps.logger.debug("TMDB search", { query });

    try {
      const results = intent
        ? await discoverVideasy(intent, signal)
        : await searchVideasy(query, signal);
      this.deps.logger.info("TMDB search complete", { query, count: results.length });
      return results;
    } catch (e) {
      this.deps.logger.error("TMDB search failed", { query, error: String(e) });
      throw e;
    }
  }

  async getTitleDetails(_id: string, _signal?: AbortSignal): Promise<TitleInfo | null> {
    // TMDB search results already contain full details
    // For now, return null - could be enhanced later
    return null;
  }
}

export function createTMDBSearchService(deps: SearchDeps): SearchService {
  return new TMDBSearchService(deps);
}
