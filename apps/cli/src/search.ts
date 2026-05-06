// =============================================================================
// Search service registry
//
// A SearchService wraps a search endpoint so the UI knows:
//   • which providers can consume its results
//   • which service name to show in error messages
//
// API providers own their own search() — they don't
// appear here. This layer is for providers that delegate search to a shared
// HTTP endpoint (TMDB proxy today; HiAnime as a future SearchService).
// =============================================================================

export type SearchResult = {
  id: string;
  type: "movie" | "series";
  title: string;
  year: string;
  overview: string;
  posterPath: string | null;
  rating?: number | null;
  popularity?: number | null;
};

export type SearchService = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly compatibleProviders: readonly string[];
  search(query: string): Promise<SearchResult[]>;
};

// db.videasy.net is the same TMDB-format API that powers cineby + vidking.
// No API key needed. Response is identical to TMDB /search/multi.

const cache = new Map<string, SearchResult[]>();

export async function searchVideasy(query: string): Promise<SearchResult[]> {
  const key = query.toLowerCase().trim();
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const url = `https://db.videasy.net/3/search/multi?language=en&page=1&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);

  const data = (await res.json()) as Record<string, unknown>;
  const rawResults = Array.isArray(data.results) ? data.results : [];
  const results: SearchResult[] = rawResults
    .map(readSearchRecord)
    .filter((r) => r.media_type === "movie" || r.media_type === "tv")
    .slice(0, 12)
    .map((r) => ({
      id: String(r.id),
      type: (r.media_type === "tv" ? "series" : "movie") as "movie" | "series",
      title: readString(r.title) || readString(r.name) || "Unknown",
      year: (readString(r.release_date) || readString(r.first_air_date)).split("-")[0] || "?",
      overview: readString(r.overview).slice(0, 120),
      posterPath: readString(r.poster_path) || null,
      rating: typeof r.vote_average === "number" ? r.vote_average : null,
      popularity: typeof r.popularity === "number" ? r.popularity : null,
    }));

  cache.set(key, results);
  return results;
}

function readSearchRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// ── Search service registry ───────────────────────────────────────────────────
//
// Named service objects so the UI and error messages know which endpoint
// failed. API providers own their own search() and
// don't appear here — this registry is for shared-endpoint providers only.

export const TMDB_SERVICE: SearchService = {
  id: "tmdb",
  name: "TMDB / Videasy",
  description: "TMDB proxy (db.videasy.net) — movies, series, no API key",
  compatibleProviders: ["vidking"],
  search: searchVideasy,
};

export const SEARCH_SERVICES: readonly SearchService[] = [TMDB_SERVICE];

export const SEARCH_SERVICE_MAP: Readonly<Record<string, SearchService>> = Object.fromEntries(
  SEARCH_SERVICES.map((s) => [s.id, s]),
);
