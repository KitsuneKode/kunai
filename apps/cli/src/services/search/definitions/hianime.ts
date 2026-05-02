// =============================================================================
// HiAnime Search Service
//
// Used by Cineby Anime.
// =============================================================================

import type { SearchResult, TitleInfo, SearchMetadata } from "@/domain/types";

import type { SearchService, SearchDeps } from "../SearchService";

const HIANIME_SEARCH = "https://anime-db.videasy.net/api/v2/hianime/search";

export class HiAnimeSearchService implements SearchService {
  readonly metadata: SearchMetadata = {
    id: "hianime",
    name: "HiAnime (Cineby Anime)",
    description: "HiAnime search (anime-db.videasy.net)",
  };

  readonly compatibleProviders: string[] = ["cineby-anime"];

  constructor(private deps: SearchDeps) {}

  async search(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
    const url = `${HIANIME_SEARCH}?q=${encodeURIComponent(query)}&page=1`;
    const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HiAnime search ${res.status}: ${url}`);

    const data = (await res.json()) as any;
    const raw = data?.data?.animes ?? data?.results ?? data?.animes ?? [];

    return (raw as any[]).map(
      (a): SearchResult => ({
        id: String(a.id ?? a.animeId ?? ""),
        title: String(a.name ?? a.title ?? a.english ?? a.romaji ?? a.id ?? "Unknown"),
        type: "series",
        year: a.premiered ? (String(a.premiered).split(" ").pop() ?? "") : "",
        posterPath: a.poster,
        overview: "",
      }),
    );
  }

  async getTitleDetails(_id: string, _signal?: AbortSignal): Promise<TitleInfo | null> {
    // HiAnime search results are already detailed enough for title pickers.
    // In this simple implementation, we don't have a separate details endpoint.
    return null;
  }
}

export function createHiAnimeSearchService(deps: SearchDeps): SearchService {
  return new HiAnimeSearchService(deps);
}
