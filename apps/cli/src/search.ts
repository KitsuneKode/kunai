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

import { withTimeoutSignal } from "./infra/abort/timeout-signal";

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

export async function searchVideasy(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const key = query.toLowerCase().trim();
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const url = `https://db.videasy.net/3/search/multi?language=en&page=1&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal: withTimeoutSignal(signal, 8000) });
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

export type VideasyDiscoverPlan = {
  readonly urls: readonly { readonly url: string; readonly type: "movie" | "series" }[];
  readonly evidence: {
    readonly upstream: readonly string[];
    readonly unsupported: readonly string[];
  };
};

export async function discoverVideasy(
  intent: import("./domain/search/SearchIntent").SearchIntent,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const { urls } = buildVideasyDiscoverPlan(intent);
  if (urls.length === 0) return searchVideasy(intent.query, signal);

  const responses = await Promise.allSettled(
    urls.map(async ({ url, type }) => {
      const res = await fetch(url, { signal: withTimeoutSignal(signal, 8000) });
      if (!res.ok) throw new Error(`Search failed: ${res.status}`);
      const data = (await res.json()) as Record<string, unknown>;
      const rawResults = Array.isArray(data.results) ? data.results : [];
      return rawResults
        .map(readSearchRecord)
        .filter((record) => record.id !== null && record.id !== undefined)
        .map((record): SearchResult => {
          const posterPath = readString(record.poster_path) || null;
          return {
            id: String(record.id),
            type,
            title: readString(record.title) || readString(record.name) || "Unknown",
            year:
              (readString(record.release_date) || readString(record.first_air_date)).split(
                "-",
              )[0] || "?",
            overview: readString(record.overview).slice(0, 120),
            posterPath,
            rating: typeof record.vote_average === "number" ? record.vote_average : null,
            popularity: typeof record.popularity === "number" ? record.popularity : null,
          };
        });
    }),
  );

  const fulfilled = responses
    .filter((response): response is PromiseFulfilledResult<SearchResult[]> => {
      return response.status === "fulfilled";
    })
    .flatMap((response) => response.value);
  if (fulfilled.length > 0) return fulfilled.slice(0, 20);

  const firstFailure = responses.find(
    (response): response is PromiseRejectedResult => response.status === "rejected",
  );
  throw firstFailure?.reason instanceof Error
    ? firstFailure.reason
    : new Error("Search failed: all TMDB discover endpoints failed");
}

export function buildVideasyDiscoverUrls(
  intent: import("./domain/search/SearchIntent").SearchIntent,
): readonly { readonly url: string; readonly type: "movie" | "series" }[] {
  return buildVideasyDiscoverPlan(intent).urls;
}

export function buildVideasyDiscoverPlan(
  intent: import("./domain/search/SearchIntent").SearchIntent,
): VideasyDiscoverPlan {
  if (intent.query.trim().length > 0) {
    return { urls: [], evidence: { upstream: [], unsupported: [] } };
  }
  const mediaTypes = resolveTmdbMediaTypes(intent);
  if (mediaTypes.length === 0) {
    return { urls: [], evidence: { upstream: [], unsupported: [] } };
  }

  const urls: VideasyDiscoverPlan["urls"] = mediaTypes.map((mediaType) => {
    const params = new URLSearchParams({
      language: "en-US",
      page: "1",
      sort_by: tmdbSortBy(intent.sort, mediaType),
      "vote_count.gte": intent.sort === "rating" ? "150" : "20",
    });

    const genreId = resolveTmdbGenreId(intent.filters.genres?.[0], mediaType);
    if (genreId) params.set("with_genres", genreId);
    if (typeof intent.filters.minRating === "number") {
      params.set("vote_average.gte", String(intent.filters.minRating));
    }
    applyTmdbYearParams(params, intent.filters.year, mediaType);

    return {
      type: mediaType === "tv" ? ("series" as const) : ("movie" as const),
      url: `https://db.videasy.net/3/discover/${mediaType}?${params.toString()}`,
    };
  });

  return {
    urls,
    evidence: {
      upstream: buildTmdbUpstreamEvidence(intent, mediaTypes),
      unsupported: buildTmdbUnsupportedEvidence(intent, mediaTypes),
    },
  };
}

function resolveTmdbMediaTypes(
  intent: import("./domain/search/SearchIntent").SearchIntent,
): readonly ("movie" | "tv")[] {
  if (intent.filters.type === "movie" || intent.mode === "movie") return ["movie"];
  if (intent.filters.type === "series" || intent.mode === "series") return ["tv"];
  return ["movie", "tv"];
}

function tmdbSortBy(
  sort: import("./domain/search/SearchIntent").SearchSort,
  mediaType: "movie" | "tv",
): string {
  if (sort === "rating") return "vote_average.desc";
  if (sort === "recent")
    return mediaType === "movie" ? "primary_release_date.desc" : "first_air_date.desc";
  return "popularity.desc";
}

function applyTmdbYearParams(
  params: URLSearchParams,
  year: import("./domain/search/SearchIntent").SearchIntentFilters["year"],
  mediaType: "movie" | "tv",
): void {
  if (!year) return;
  const prefix = mediaType === "movie" ? "primary_release_date" : "first_air_date";
  if (typeof year === "number") {
    params.set(
      mediaType === "movie" ? "primary_release_year" : "first_air_date_year",
      String(year),
    );
    return;
  }
  if (typeof year.from === "number") params.set(`${prefix}.gte`, `${year.from}-01-01`);
  if (typeof year.to === "number") params.set(`${prefix}.lte`, `${year.to}-12-31`);
}

const TMDB_MOVIE_GENRES: Readonly<Record<string, string>> = {
  action: "28",
  adventure: "12",
  animation: "16",
  comedy: "35",
  crime: "80",
  documentary: "99",
  drama: "18",
  family: "10751",
  fantasy: "14",
  history: "36",
  horror: "27",
  mystery: "9648",
  romance: "10749",
  "science-fiction": "878",
  "sci-fi": "878",
  scifi: "878",
  thriller: "53",
  war: "10752",
  western: "37",
};

const TMDB_TV_GENRES: Readonly<Record<string, string>> = {
  action: "10759",
  adventure: "10759",
  animation: "16",
  comedy: "35",
  crime: "80",
  documentary: "99",
  drama: "18",
  family: "10751",
  kids: "10762",
  mystery: "9648",
  news: "10763",
  reality: "10764",
  romance: "10749",
  "science-fiction": "10765",
  "sci-fi": "10765",
  scifi: "10765",
  fantasy: "10765",
  soap: "10766",
  talk: "10767",
  politics: "10768",
  western: "37",
};

function resolveTmdbGenreId(genre: string | undefined, mediaType: "movie" | "tv"): string | null {
  if (!genre) return null;
  const normalized = genre.trim().toLowerCase().replace(/\s+/g, "-");
  return (mediaType === "movie" ? TMDB_MOVIE_GENRES : TMDB_TV_GENRES)[normalized] ?? null;
}

function buildTmdbUpstreamEvidence(
  intent: import("./domain/search/SearchIntent").SearchIntent,
  mediaTypes: readonly ("movie" | "tv")[],
): readonly string[] {
  return [
    intent.filters.type || intent.mode === "movie" || intent.mode === "series" ? "type" : null,
    getSupportedTmdbGenreEvidence(intent.filters.genres?.[0], mediaTypes),
    typeof intent.filters.minRating === "number" ? "rating" : null,
    intent.filters.year ? "year" : null,
    intent.sort !== "relevance" && intent.sort !== "progress" ? "sort" : null,
  ].filter((value): value is string => Boolean(value));
}

function buildTmdbUnsupportedEvidence(
  intent: import("./domain/search/SearchIntent").SearchIntent,
  mediaTypes: readonly ("movie" | "tv")[],
): readonly string[] {
  const genres = intent.filters.genres ?? [];
  return genres
    .filter((genre, index) => index > 0 || !isTmdbGenreSupported(genre, mediaTypes))
    .map((genre) => `genre:${normalizeTmdbGenreKey(genre)}`);
}

function getSupportedTmdbGenreEvidence(
  genre: string | undefined,
  mediaTypes: readonly ("movie" | "tv")[],
): string | null {
  if (!genre || !isTmdbGenreSupported(genre, mediaTypes)) return null;
  return `genre:${normalizeTmdbGenreKey(genre)}`;
}

function isTmdbGenreSupported(genre: string, mediaTypes: readonly ("movie" | "tv")[]): boolean {
  return mediaTypes.some((mediaType) => resolveTmdbGenreId(genre, mediaType));
}

function normalizeTmdbGenreKey(genre: string): string {
  return genre.trim().toLowerCase().replace(/\s+/g, "-");
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
