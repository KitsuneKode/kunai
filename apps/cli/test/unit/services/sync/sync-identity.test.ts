import { describe, expect, test } from "bun:test";

import {
  resolveAniListMediaId,
  resolveTmdbId,
  resolveTmdbMediaType,
  resolveTrackerEpisode,
  syncDedupeKey,
} from "@/services/sync/sync-identity";

describe("resolveAniListMediaId", () => {
  test("prefers the enriched AniList id", () => {
    expect(
      resolveAniListMediaId({
        titleId: "allanime:abc",
        mediaKind: "anime",
        externalIds: { anilistId: "142329" },
      }),
    ).toBe(142329);
  });

  test("reads an anilist-prefixed title id", () => {
    expect(resolveAniListMediaId({ titleId: "anilist:21", mediaKind: "anime" })).toBe(21);
  });

  test("treats a bare numeric anime id as AniList, matching the anime lane convention", () => {
    expect(resolveAniListMediaId({ titleId: "16498", mediaKind: "anime" })).toBe(16498);
  });

  // The bug this module exists to prevent: TMDB and AniList number their
  // catalogs independently, so reading a TMDB id as an AniList media id writes
  // the user's progress onto an unrelated anime.
  test("never reads a TMDB id as an AniList id", () => {
    expect(resolveAniListMediaId({ titleId: "tmdb:1399", mediaKind: "series" })).toBeUndefined();
    expect(
      resolveAniListMediaId({
        titleId: "tmdb:1399",
        mediaKind: "series",
        externalIds: { tmdbId: "1399" },
      }),
    ).toBeUndefined();
  });

  // MAL ids collide with AniList ids just as freely.
  test("never reads a MAL id as an AniList id", () => {
    expect(resolveAniListMediaId({ titleId: "mal:1535", mediaKind: "anime" })).toBeUndefined();
    expect(
      resolveAniListMediaId({
        titleId: "mal:1535",
        mediaKind: "anime",
        externalIds: { malId: "1535" },
      }),
    ).toBeUndefined();
  });

  test("does not treat a bare numeric non-anime id as an AniList id", () => {
    expect(resolveAniListMediaId({ titleId: "1399", mediaKind: "series" })).toBeUndefined();
  });

  test("rejects malformed and non-positive ids", () => {
    expect(resolveAniListMediaId({ titleId: "anilist:abc", mediaKind: "anime" })).toBeUndefined();
    expect(
      resolveAniListMediaId({ titleId: "x", mediaKind: "anime", externalIds: { anilistId: "0" } }),
    ).toBeUndefined();
  });
});

describe("resolveTmdbId", () => {
  test("reads the enriched id and the prefixed title id", () => {
    expect(
      resolveTmdbId({ titleId: "x", mediaKind: "movie", externalIds: { tmdbId: "603" } }),
    ).toBe(603);
    expect(resolveTmdbId({ titleId: "tmdb:1399", mediaKind: "series" })).toBe(1399);
  });

  test("never reads an AniList id as a TMDB id", () => {
    expect(
      resolveTmdbId({
        titleId: "anilist:21",
        mediaKind: "anime",
        externalIds: { anilistId: "21" },
      }),
    ).toBeUndefined();
    expect(resolveTmdbId({ titleId: "16498", mediaKind: "anime" })).toBeUndefined();
  });
});

describe("resolveTmdbMediaType", () => {
  test("maps Kunai media kinds onto TMDB's two catalogs", () => {
    expect(resolveTmdbMediaType("movie")).toBe("movie");
    expect(resolveTmdbMediaType("series")).toBe("tv");
    expect(resolveTmdbMediaType("anime")).toBe("tv");
  });

  test("has no mapping for standalone video", () => {
    expect(resolveTmdbMediaType("video")).toBeUndefined();
  });
});

describe("resolveTrackerEpisode", () => {
  test("movies always report a single episode", () => {
    expect(resolveTrackerEpisode({ mediaKind: "movie" })).toBe(1);
  });

  test("season 1 reports the plain episode number", () => {
    expect(resolveTrackerEpisode({ mediaKind: "anime", season: 1, episode: 7 })).toBe(7);
  });

  // Reporting the within-season number for a later season would tell the
  // tracker the user is on episode 3 when they just finished episode 27.
  test("later seasons prefer the absolute number when one exists", () => {
    expect(
      resolveTrackerEpisode({ mediaKind: "series", season: 2, episode: 3, absoluteEpisode: 27 }),
    ).toBe(27);
  });

  test("falls back to the within-season number when no absolute number exists", () => {
    expect(resolveTrackerEpisode({ mediaKind: "series", season: 2, episode: 3 })).toBe(3);
  });

  test("returns undefined when there is no episode to report", () => {
    expect(resolveTrackerEpisode({ mediaKind: "series" })).toBeUndefined();
  });
});

describe("syncDedupeKey", () => {
  test("is stable per title and episode", () => {
    expect(syncDedupeKey({ titleId: "anilist:21", season: 1, episode: 5 })).toBe(
      syncDedupeKey({ titleId: "anilist:21", season: 1, episode: 5 }),
    );
  });

  test("separates different episodes of the same title", () => {
    expect(syncDedupeKey({ titleId: "anilist:21", episode: 5 })).not.toBe(
      syncDedupeKey({ titleId: "anilist:21", episode: 6 }),
    );
  });
});
