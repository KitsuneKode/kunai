// =============================================================================
// Unit tests for TitleDetailService
//
// Covers:
//   1. Source → TitleDetail mapping (TMDB movie, TMDB series, AniList anime)
//   2. Per-kind artwork preference routing
//   3. Parallel merge: TMDB primary wins scalars, AniList back-fills
//   4. In-memory cache deduplication
//   5. Graceful degradation when a source fails
//   6. ExternalId passthrough
// =============================================================================

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { ARTWORK_PREFERENCE, episodeThumbKey, mergeArtwork } from "@/domain/catalog/title-detail";
import {
  clearTitleDetailCache,
  fetchTitleDetail,
  peekTitleDetail,
} from "@/services/catalog/TitleDetailService";

// ---------------------------------------------------------------------------
// Helpers to build minimal fake TMDB/AniList API responses
// ---------------------------------------------------------------------------

function tmdbMoviePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 550,
    title: "Fight Club",
    overview: "A ticking-time-bomb insomniac and a slippery soap salesman.",
    poster_path: "/poster.jpg",
    backdrop_path: "/backdrop.jpg",
    release_date: "1999-10-15",
    status: "Released",
    runtime: 139,
    genres: [{ id: 18, name: "Drama" }],
    production_companies: [{ id: 1, name: "Fox" }],
    ...overrides,
  };
}

function tmdbSeriesPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1396,
    name: "Breaking Bad",
    overview: "A chemistry teacher turned drug lord.",
    poster_path: "/bb-poster.jpg",
    backdrop_path: "/bb-backdrop.jpg",
    first_air_date: "2008-01-20",
    status: "Ended",
    number_of_seasons: 5,
    number_of_episodes: 62,
    episode_run_time: [47],
    genres: [
      { id: 18, name: "Drama" },
      { id: 80, name: "Crime" },
    ],
    production_companies: [{ id: 2, name: "Sony" }],
    networks: [{ id: 174, name: "AMC" }],
    seasons: [
      {
        season_number: 1,
        episode_count: 7,
        name: "Season 1",
        air_date: "2008-01-20",
        poster_path: "/s1.jpg",
      },
      {
        season_number: 2,
        episode_count: 13,
        name: "Season 2",
        air_date: "2009-03-08",
        poster_path: "/s2.jpg",
      },
    ],
    ...overrides,
  };
}

function tmdbCreditsPayload(): Record<string, unknown> {
  return {
    cast: [
      { name: "Bryan Cranston", character: "Walter White", profile_path: "/bryan.jpg" },
      { name: "Aaron Paul", character: "Jesse Pinkman", profile_path: null },
    ],
  };
}

function tmdbExternalIdsPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    imdb_id: "tt0903747",
    anilist_id: null,
    ...overrides,
  };
}

function tmdbSeasonPayload(
  seasonNum: number,
  episodes: Array<{ episode_number: number; still_path: string | null }>,
): Record<string, unknown> {
  return {
    season_number: seasonNum,
    episodes: episodes.map(({ episode_number, still_path }) => ({
      episode_number,
      still_path,
    })),
  };
}

function anilistMediaPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 21,
    idMal: 12345,
    title: { romaji: "One Piece", english: "One Piece", native: "ワンピース" },
    description: "Monkey D. Luffy sets off on an adventure.",
    genres: ["Action", "Adventure", "Fantasy"],
    episodes: 1000,
    duration: 24,
    status: "RELEASING",
    startDate: { year: 1999, month: 10, day: 20 },
    coverImage: { extraLarge: "https://anilist.co/poster.jpg", large: null },
    bannerImage: "https://anilist.co/banner.jpg",
    studios: { nodes: [{ name: "Toei Animation" }] },
    characters: {
      nodes: [
        {
          name: { full: "Monkey D. Luffy" },
          image: { medium: "https://anilist.co/luffy.jpg" },
        },
        {
          name: { full: "Roronoa Zoro" },
          image: { medium: null },
        },
      ],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock fetch setup
// ---------------------------------------------------------------------------

type RouteHandler = (url: string) => Response | null;

function mockFetch(handler: RouteHandler): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const result = handler(url);
    if (result) return result;
    // Default: 404
    return new Response(JSON.stringify({ status: 404 }), { status: 404 });
  }) as unknown as typeof fetch;

  return () => {
    globalThis.fetch = original;
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearTitleDetailCache();
});

afterEach(() => {
  clearTitleDetailCache();
});

// ---------------------------------------------------------------------------
// 1. TMDB movie mapping
// ---------------------------------------------------------------------------

describe("TitleDetailService — TMDB movie", () => {
  test("maps title, year, synopsis, genres, studios, runtime, releaseDate from TMDB payload", async () => {
    const restore = mockFetch((url) => {
      if (url.includes("/movie/550"))
        return jsonResponse({
          ...tmdbMoviePayload(),
          credits: { cast: [] },
          external_ids: tmdbExternalIdsPayload(),
          videos: { results: [] },
        });
      return null;
    });

    const detail = await fetchTitleDetail("tmdb:550", "movie");

    expect(detail.id).toBe("tmdb:550");
    expect(detail.type).toBe("movie");
    expect(detail.title).toBe("Fight Club");
    expect(detail.year).toBe("1999");
    expect(detail.synopsis).toContain("ticking-time-bomb");
    expect(detail.genres).toContain("Drama");
    expect(detail.studios).toContain("Fox");
    expect(detail.runtimeMinutes).toBe(139);
    expect(detail.releaseDate).toBe("1999-10-15");
    expect(detail.externalIds?.tmdbId).toBe("550");
    expect(detail.externalIds?.imdbId).toBe("tt0903747");

    restore();
  });

  test("builds poster and backdrop artwork with w500/w780 sizes", async () => {
    const restore = mockFetch((url) => {
      if (url.includes("/movie/550"))
        return jsonResponse({
          ...tmdbMoviePayload(),
          credits: { cast: [] },
          external_ids: tmdbExternalIdsPayload(),
          videos: { results: [] },
        });
      return null;
    });

    const detail = await fetchTitleDetail("tmdb:550", "movie");

    expect(detail.artwork?.poster).toBe("https://image.tmdb.org/t/p/w500/poster.jpg");
    expect(detail.artwork?.backdrop).toBe("https://image.tmdb.org/t/p/w780/backdrop.jpg");
    expect(detail.artwork?.contributingSources).toContain("tmdb");

    restore();
  });

  test("maps cast members as actors with role and photoUrl", async () => {
    const restore = mockFetch((url) => {
      if (url.includes("/movie/550"))
        return jsonResponse({
          ...tmdbMoviePayload(),
          credits: {
            cast: [{ name: "Brad Pitt", character: "Tyler Durden", profile_path: "/brad.jpg" }],
          },
          external_ids: tmdbExternalIdsPayload(),
          videos: { results: [] },
        });
      return null;
    });

    const detail = await fetchTitleDetail("tmdb:550", "movie");

    expect(detail.cast).toBeDefined();
    expect(detail.cast?.[0]).toMatchObject({
      name: "Brad Pitt",
      role: "Tyler Durden",
      kind: "actor",
      photoUrl: "https://image.tmdb.org/t/p/w185/brad.jpg",
    });

    restore();
  });
});

// ---------------------------------------------------------------------------
// 2. TMDB series mapping
// ---------------------------------------------------------------------------

describe("TitleDetailService — TMDB series", () => {
  test("maps seasonCount, episodeCount, seasons[], and episode thumbnails", async () => {
    const restore = mockFetch((url) => {
      if (url.includes("/tv/1396") && !url.includes("/season/"))
        return jsonResponse({
          ...tmdbSeriesPayload(),
          credits: tmdbCreditsPayload(),
          external_ids: tmdbExternalIdsPayload(),
          videos: { results: [] },
        });
      if (url.includes("/tv/1396/season/1"))
        return jsonResponse(
          tmdbSeasonPayload(1, [
            { episode_number: 1, still_path: "/ep1.jpg" },
            { episode_number: 2, still_path: null },
          ]),
        );
      if (url.includes("/tv/1396/season/2"))
        return jsonResponse(tmdbSeasonPayload(2, [{ episode_number: 1, still_path: "/s2e1.jpg" }]));
      return null;
    });

    const detail = await fetchTitleDetail("tmdb:1396", "series");

    expect(detail.seasonCount).toBe(2);
    expect(detail.episodeCount).toBe(20);
    expect(detail.seasons).toBeDefined();
    expect(detail.seasons?.length).toBe(2);
    expect(detail.seasons?.[0]?.season).toBe(1);
    expect(detail.seasons?.[0]?.episodeCount).toBe(7);
    expect(detail.seasons?.[0]?.name).toBe("Season 1");

    // Season posters
    expect(detail.artwork?.seasonPosters?.[1]).toBe("https://image.tmdb.org/t/p/w342/s1.jpg");

    // Episode thumbnails
    expect(detail.artwork?.episodeThumbnails?.[episodeThumbKey(1, 1)]).toBe(
      "https://image.tmdb.org/t/p/w300/ep1.jpg",
    );
    // Episode with no still should be absent
    expect(detail.artwork?.episodeThumbnails?.[episodeThumbKey(1, 2)]).toBeUndefined();

    restore();
  });

  test("maps cast as actors with kind=actor", async () => {
    const restore = mockFetch((url) => {
      if (url.includes("/tv/1396") && !url.includes("/season/"))
        return jsonResponse({
          ...tmdbSeriesPayload(),
          credits: tmdbCreditsPayload(),
          external_ids: tmdbExternalIdsPayload(),
          videos: { results: [] },
        });
      if (url.includes("/season/")) return jsonResponse({ episodes: [] });
      return null;
    });

    const detail = await fetchTitleDetail("tmdb:1396", "series");

    expect(detail.cast?.[0]).toMatchObject({
      name: "Bryan Cranston",
      role: "Walter White",
      kind: "actor",
      photoUrl: "https://image.tmdb.org/t/p/w185/bryan.jpg",
    });
    // null profile_path → no photoUrl
    expect(detail.cast?.[1]?.photoUrl).toBeUndefined();

    restore();
  });
});

// ---------------------------------------------------------------------------
// 3. AniList mapping
// ---------------------------------------------------------------------------

describe("TitleDetailService — AniList anime", () => {
  test("maps title, year, synopsis, genres, studios, episodeCount, status", async () => {
    const restore = mockFetch((url) => {
      if (url.includes("graphql.anilist.co"))
        return jsonResponse({ data: { Media: anilistMediaPayload() } });
      return null;
    });

    const detail = await fetchTitleDetail("anilist:21", "series");

    expect(detail.title).toBe("One Piece");
    expect(detail.year).toBe("1999");
    expect(detail.synopsis).toContain("Luffy");
    expect(detail.genres).toContain("Action");
    expect(detail.genres).toContain("Fantasy");
    expect(detail.studios).toContain("Toei Animation");
    expect(detail.episodeCount).toBe(1000);
    expect(detail.status).toBe("airing");
    expect(detail.runtimeMinutes).toBe(24);
    expect(detail.releaseDate).toBe("1999-10-20");

    restore();
  });

  test("builds artwork with anilist poster and banner as backdrop", async () => {
    const restore = mockFetch((url) => {
      if (url.includes("graphql.anilist.co"))
        return jsonResponse({ data: { Media: anilistMediaPayload() } });
      return null;
    });

    const detail = await fetchTitleDetail("anilist:21", "series");

    expect(detail.artwork?.poster).toBe("https://anilist.co/poster.jpg");
    expect(detail.artwork?.backdrop).toBe("https://anilist.co/banner.jpg");
    expect(detail.artwork?.contributingSources).toContain("anilist");

    restore();
  });

  test("maps characters as voice cast with kind=voice", async () => {
    const restore = mockFetch((url) => {
      if (url.includes("graphql.anilist.co"))
        return jsonResponse({ data: { Media: anilistMediaPayload() } });
      return null;
    });

    const detail = await fetchTitleDetail("anilist:21", "series");

    expect(detail.cast?.[0]).toMatchObject({
      name: "Monkey D. Luffy",
      kind: "voice",
      photoUrl: "https://anilist.co/luffy.jpg",
    });
    expect(detail.cast?.[1]?.photoUrl).toBeUndefined();

    restore();
  });

  test("passes through anilistId and malId as externalIds", async () => {
    const restore = mockFetch((url) => {
      if (url.includes("graphql.anilist.co"))
        return jsonResponse({ data: { Media: anilistMediaPayload() } });
      return null;
    });

    const detail = await fetchTitleDetail("anilist:21", "series");

    expect(detail.externalIds?.anilistId).toBe("21");
    expect(detail.externalIds?.malId).toBe("12345");

    restore();
  });
});

// ---------------------------------------------------------------------------
// 4. Artwork preference per content kind
// ---------------------------------------------------------------------------

describe("TitleDetailService — artwork preference routing", () => {
  test("anime kind uses ARTWORK_PREFERENCE.anime (anilist > tmdb > tvdb > provider)", () => {
    // This directly tests the preference constant consumed by mergeArtwork
    const pref = ARTWORK_PREFERENCE.anime;
    expect(pref[0]).toBe("anilist");
    expect(pref[1]).toBe("tmdb");
  });

  test("series kind uses ARTWORK_PREFERENCE.series (tmdb > tvdb > anilist > provider)", () => {
    const pref = ARTWORK_PREFERENCE.series;
    expect(pref[0]).toBe("tmdb");
    expect(pref[1]).toBe("tvdb");
    expect(pref[2]).toBe("anilist");
  });

  test("movie kind uses ARTWORK_PREFERENCE.movie (tmdb first)", () => {
    const pref = ARTWORK_PREFERENCE.movie;
    expect(pref[0]).toBe("tmdb");
  });

  test("mergeArtwork with anime pref: anilist poster wins over tmdb poster", () => {
    const result = mergeArtwork(
      [
        { source: "tmdb", poster: "tmdb-poster", backdrop: "tmdb-bd" },
        { source: "anilist", poster: "anilist-poster" },
      ],
      ARTWORK_PREFERENCE.anime,
    );
    expect(result.poster).toBe("anilist-poster");
    // TMDB back-fills the backdrop that AniList lacks
    expect(result.backdrop).toBe("tmdb-bd");
  });

  test("mergeArtwork with series pref: tmdb poster wins over anilist poster", () => {
    const result = mergeArtwork(
      [
        { source: "tmdb", poster: "tmdb-poster" },
        { source: "anilist", poster: "anilist-poster", backdrop: "anilist-bd" },
      ],
      ARTWORK_PREFERENCE.series,
    );
    expect(result.poster).toBe("tmdb-poster");
    // AniList back-fills backdrop
    expect(result.backdrop).toBe("anilist-bd");
  });

  test("mergeArtwork season posters merge per-key across sources", () => {
    const result = mergeArtwork(
      [
        { source: "tmdb", seasonPosters: { 1: "tmdb-s1", 2: "tmdb-s2" } },
        { source: "anilist", seasonPosters: { 1: "al-s1", 3: "al-s3" } },
      ],
      ARTWORK_PREFERENCE.series,
    );
    expect(result.seasonPosters?.[1]).toBe("tmdb-s1"); // tmdb preferred
    expect(result.seasonPosters?.[2]).toBe("tmdb-s2");
    expect(result.seasonPosters?.[3]).toBe("al-s3"); // back-filled
  });
});

// ---------------------------------------------------------------------------
// 5. In-memory cache
// ---------------------------------------------------------------------------

describe("TitleDetailService — caching", () => {
  test("second call for same id+type returns cached result without another fetch", async () => {
    let calls = 0;
    const restore = mockFetch((url) => {
      if (
        url.includes("/movie/999") &&
        !url.includes("/credits") &&
        !url.includes("/external_ids")
      ) {
        calls++;
        return jsonResponse(tmdbMoviePayload({ id: 999, title: "Cached Movie" }));
      }
      if (url.includes("/movie/999/credits")) return jsonResponse({ cast: [] });
      if (url.includes("/movie/999/external_ids")) return jsonResponse({ imdb_id: null });
      return null;
    });

    const first = await fetchTitleDetail("tmdb:999", "movie");
    const second = await fetchTitleDetail("tmdb:999", "movie");

    expect(first).toBe(second); // same reference
    expect(calls).toBe(1); // only one main-detail fetch

    restore();
  });

  test("clearTitleDetailCache causes re-fetch", async () => {
    let calls = 0;
    const restore = mockFetch((url) => {
      if (
        url.includes("/movie/998") &&
        !url.includes("/credits") &&
        !url.includes("/external_ids")
      ) {
        calls++;
        return jsonResponse(tmdbMoviePayload({ id: 998, title: `Movie ${calls}` }));
      }
      if (url.includes("/movie/998/credits")) return jsonResponse({ cast: [] });
      if (url.includes("/movie/998/external_ids")) return jsonResponse({ imdb_id: null });
      return null;
    });

    await fetchTitleDetail("tmdb:998", "movie");
    clearTitleDetailCache();
    await fetchTitleDetail("tmdb:998", "movie");

    expect(calls).toBe(2);

    restore();
  });

  test("peekTitleDetail returns undefined when cold and the cached detail once warm", async () => {
    const restore = mockFetch((url) => {
      if (
        url.includes("/movie/997") &&
        !url.includes("/credits") &&
        !url.includes("/external_ids")
      ) {
        return jsonResponse(tmdbMoviePayload({ id: 997, title: "Peeked Movie" }));
      }
      if (url.includes("/movie/997/credits")) return jsonResponse({ cast: [] });
      if (url.includes("/movie/997/external_ids")) return jsonResponse({ imdb_id: null });
      return null;
    });

    // Cold: never fetched → no blocking, just undefined.
    expect(peekTitleDetail("tmdb:997", "movie")).toBeUndefined();

    const fetched = await fetchTitleDetail("tmdb:997", "movie");
    // Warm: same reference the fetch cached, no network call.
    expect(peekTitleDetail("tmdb:997", "movie")).toBe(fetched);

    restore();
  });
});

// ---------------------------------------------------------------------------
// 6. Graceful degradation
// ---------------------------------------------------------------------------

describe("TitleDetailService — graceful degradation", () => {
  test("returns a valid TitleDetail when TMDB returns non-OK (503)", async () => {
    const restore = mockFetch((_url) => new Response("", { status: 503 }));

    // Should not throw — returns a stub with just the id and type
    const detail = await fetchTitleDetail("tmdb:1", "movie");
    expect(detail.id).toBe("tmdb:1");
    expect(detail.type).toBe("movie");
    expect(detail.title).toBe("Unknown");

    restore();
  });

  test("returns a valid TitleDetail when AniList is unreachable", async () => {
    const restore = mockFetch((_url) => {
      throw new Error("Network error");
    });

    const detail = await fetchTitleDetail("anilist:99", "series");
    expect(detail.id).toBe("anilist:99");
    expect(detail.type).toBe("series");

    restore();
  });

  test("TMDB partial failure (credits 500): still returns detail without cast", async () => {
    const restore = mockFetch((url) => {
      if (url.includes("/movie/777") && !url.includes("/credits") && !url.includes("/external_ids"))
        return jsonResponse(tmdbMoviePayload({ id: 777 }));
      if (url.includes("/movie/777/credits")) return new Response("Error", { status: 500 });
      if (url.includes("/movie/777/external_ids")) return jsonResponse({ imdb_id: null });
      return null;
    });

    const detail = await fetchTitleDetail("tmdb:777", "movie");
    expect(detail.title).toBe("Fight Club");
    // Cast is empty/undefined because credits failed — but detail is otherwise valid
    expect(detail.cast === undefined || detail.cast.length === 0).toBe(true);

    restore();
  });
});

// ---------------------------------------------------------------------------
// 7. Bare numeric id treated as TMDB id
// ---------------------------------------------------------------------------

describe("TitleDetailService — id format compat", () => {
  test("bare numeric id is treated as tmdb id", async () => {
    const restore = mockFetch((url) => {
      if (url.includes("/movie/550"))
        return jsonResponse({
          ...tmdbMoviePayload(),
          credits: { cast: [] },
          external_ids: tmdbExternalIdsPayload(),
          videos: { results: [] },
        });
      return null;
    });

    const detail = await fetchTitleDetail("550", "movie");
    expect(detail.title).toBe("Fight Club");

    restore();
  });
});
