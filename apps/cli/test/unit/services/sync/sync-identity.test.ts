import { describe, expect, test } from "bun:test";

import {
  resolveAniListIdentity,
  resolveAniListProgressEpisode,
  resolveTmdbIdentity,
} from "@/services/sync/sync-identity";

/**
 * Tracker identity is the one place where a wrong answer is silently
 * destructive: every id here is a bare integer, so a MAL id, a TMDB id and an
 * AniList id are indistinguishable once the prefix is dropped. Writing progress
 * to AniList media 1535 because the title carried `mal:1535` does not fail — it
 * succeeds against somebody else's show, on the user's real account.
 *
 * So resolution is explicit or it is nothing. Prefixed ids and typed external
 * ids are the only accepted inputs; there is no numeric fallback.
 */

describe("resolveAniListIdentity", () => {
  test("accepts an explicit AniList external id", () => {
    expect(
      resolveAniListIdentity({
        titleId: "allanime:xyz",
        mediaKind: "anime",
        externalIds: { anilistId: "438631" },
      }),
    ).toEqual({ tracker: "anilist", anilistId: 438631, mediaKind: "anime" });
  });

  test("accepts an anilist-prefixed title id as the fallback", () => {
    expect(resolveAniListIdentity({ titleId: "anilist:438631", mediaKind: "anime" })).toEqual({
      tracker: "anilist",
      anilistId: 438631,
      mediaKind: "anime",
    });
  });

  test("prefers the explicit external id over the title id", () => {
    expect(
      resolveAniListIdentity({
        titleId: "anilist:111",
        mediaKind: "anime",
        externalIds: { anilistId: "222" },
      }),
    ).toEqual({ tracker: "anilist", anilistId: 222, mediaKind: "anime" });
  });

  test("rejects a bare numeric title id", () => {
    expect(resolveAniListIdentity({ titleId: "438631", mediaKind: "anime" })).toBeNull();
  });

  test("rejects a foreign namespace", () => {
    expect(resolveAniListIdentity({ titleId: "tmdb:438631", mediaKind: "anime" })).toBeNull();
  });

  /**
   * The shipped `extractAniListId` accepted `mal:` and `tmdb:` ids and returned
   * them as AniList media ids. Both are different catalogues; the number means a
   * different show in each.
   */
  test("never reinterprets a MAL id as an AniList id", () => {
    expect(resolveAniListIdentity({ titleId: "mal:1535", mediaKind: "anime" })).toBeNull();
    expect(
      resolveAniListIdentity({
        titleId: "allanime:xyz",
        mediaKind: "anime",
        externalIds: { malId: "1535" },
      }),
    ).toBeNull();
  });

  test("never reinterprets a TMDB id as an AniList id", () => {
    expect(
      resolveAniListIdentity({
        titleId: "allanime:xyz",
        mediaKind: "anime",
        externalIds: { tmdbId: "550" },
      }),
    ).toBeNull();
  });

  test("rejects whitespace, zero, negatives, and non-integers", () => {
    for (const titleId of [
      "anilist: 438631",
      "anilist:0",
      "anilist:-5",
      "anilist:43.86",
      "anilist:1e5",
      "anilist:",
      "anilist:abc",
      "anilist:438631x",
    ]) {
      expect(resolveAniListIdentity({ titleId, mediaKind: "anime" }), titleId).toBeNull();
    }
  });

  test("rejects an id too large to be a safe integer", () => {
    expect(
      resolveAniListIdentity({ titleId: `anilist:${"9".repeat(20)}`, mediaKind: "anime" }),
    ).toBeNull();
  });

  /**
   * Lane is not a precondition. Anime overwhelmingly reaches the shell as a
   * TMDB row typed `series`, so requiring `mediaKind === "anime"` rejected the
   * real titles while TMDB happily accepted them — favouriting an anime wrote
   * to the wrong tracker and never to AniList. An `anilist:` id or an explicit
   * `anilistId` is unambiguous without lane corroboration, and what it resolves
   * to is anime by definition.
   */
  test("resolves from any lane, and always reports the entry as anime", () => {
    for (const mediaKind of ["anime", "series", "movie"] as const) {
      expect(resolveAniListIdentity({ titleId: "anilist:438631", mediaKind }), mediaKind).toEqual({
        tracker: "anilist",
        anilistId: 438631,
        mediaKind: "anime",
      });
    }
  });
});

describe("resolveTmdbIdentity", () => {
  test("accepts an explicit TMDB external id for a movie", () => {
    expect(
      resolveTmdbIdentity({
        titleId: "provider:abc",
        mediaKind: "movie",
        externalIds: { tmdbId: "550" },
      }),
    ).toEqual({ tracker: "tmdb", tmdbId: 550, mediaKind: "movie" });
  });

  test("accepts a tmdb-prefixed title id for a series", () => {
    expect(resolveTmdbIdentity({ titleId: "tmdb:1396", mediaKind: "series" })).toEqual({
      tracker: "tmdb",
      tmdbId: 1396,
      mediaKind: "series",
    });
  });

  test("rejects a bare numeric title id", () => {
    expect(resolveTmdbIdentity({ titleId: "550", mediaKind: "movie" })).toBeNull();
  });

  test("rejects whitespace and malformed ids", () => {
    for (const titleId of ["tmdb: 550", "tmdb:0", "tmdb:-1", "tmdb:5.5", "tmdb:"]) {
      expect(resolveTmdbIdentity({ titleId, mediaKind: "movie" }), titleId).toBeNull();
    }
  });

  test("never reinterprets an AniList id as a TMDB id", () => {
    expect(resolveTmdbIdentity({ titleId: "anilist:438631", mediaKind: "series" })).toBeNull();
    expect(
      resolveTmdbIdentity({
        titleId: "provider:abc",
        mediaKind: "series",
        externalIds: { anilistId: "438631" },
      }),
    ).toBeNull();
  });

  /**
   * `anime` is a Kunai lane, not a TMDB media type — TMDB addresses it as `tv`
   * or `movie`. Mapping it here would guess which, so identity declines and the
   * caller keeps the anime lane on AniList.
   */
  test("does not resolve the anime lane", () => {
    expect(resolveTmdbIdentity({ titleId: "tmdb:1396", mediaKind: "anime" })).toBeNull();
  });

  test("does not resolve video", () => {
    expect(resolveTmdbIdentity({ titleId: "tmdb:1396", mediaKind: "video" })).toBeNull();
  });
});

/**
 * AniList numbers episodes within the entry the user is watching — a cour. A
 * second-cour episode 3 is absolute 27, and sending 27 marks the entry 24
 * episodes further along than the user actually is.
 */
describe("resolveAniListProgressEpisode", () => {
  test("uses the cour-relative episode when both are present", () => {
    expect(resolveAniListProgressEpisode({ episode: 3, absoluteEpisode: 27 })).toBe(3);
    expect(resolveAniListProgressEpisode({ episode: 1, absoluteEpisode: 13 })).toBe(1);
  });

  test("refuses an absolute-only number rather than guessing the cour", () => {
    expect(resolveAniListProgressEpisode({ absoluteEpisode: 27 })).toBeNull();
  });

  test("refuses a missing, zero, or non-integer episode", () => {
    expect(resolveAniListProgressEpisode({})).toBeNull();
    expect(resolveAniListProgressEpisode({ episode: 0 })).toBeNull();
    expect(resolveAniListProgressEpisode({ episode: -2 })).toBeNull();
    expect(resolveAniListProgressEpisode({ episode: 1.5 })).toBeNull();
  });
});
