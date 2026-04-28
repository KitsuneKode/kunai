// =============================================================================
// TMDB Search Service Adapter
//
// Wraps the legacy searchVideasy() into the new SearchService interface.
// =============================================================================

import { searchVideasy } from "@/search";
import type { SearchResult, TitleInfo, SearchMetadata } from "@/domain/types";
import type { SearchService, SearchDeps } from "../SearchService";

export class TMDBSearchService implements SearchService {
  readonly metadata: SearchMetadata = {
    id: "tmdb",
    name: "TMDB / Videasy",
    description: "TMDB proxy (db.videasy.net) - movies, series, no API key",
  };

  readonly compatibleProviders = ["vidking", "cineby", "bitcine", "braflix"];

  constructor(private deps: SearchDeps) {}

  async search(query: string, _signal?: AbortSignal): Promise<SearchResult[]> {
    this.deps.logger.debug("TMDB search", { query });

    try {
      const results = await searchVideasy(query);
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
