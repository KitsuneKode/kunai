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

    const data = (await res.json()) as Record<string, unknown>;
    const nested =
      data.data && typeof data.data === "object" ? (data.data as Record<string, unknown>) : {};
    const raw = nested.animes ?? data.results ?? data.animes ?? [];

    return (Array.isArray(raw) ? raw : []).map(
      (a): SearchResult => ({
        id: String(readRecord(a).id ?? readRecord(a).animeId ?? ""),
        title: String(
          readRecord(a).name ??
            readRecord(a).title ??
            readRecord(a).english ??
            readRecord(a).romaji ??
            readRecord(a).id ??
            "Unknown",
        ),
        type: "series",
        year: readRecord(a).premiered
          ? (String(readRecord(a).premiered).split(" ").pop() ?? "")
          : "",
        posterPath: readString(readRecord(a).poster) || null,
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

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function createHiAnimeSearchService(deps: SearchDeps): SearchService {
  return new HiAnimeSearchService(deps);
}
