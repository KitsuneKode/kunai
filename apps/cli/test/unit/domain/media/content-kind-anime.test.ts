import { describe, expect, test } from "bun:test";

import { classifyPersistedKind, isAnimeContent } from "@/domain/media/content-kind";
import { correctedHistoryMediaKind } from "@/services/continuation/history-progress";

describe("isAnimeContent", () => {
  test("true when an AniList or MAL id is present", () => {
    expect(isAnimeContent({ externalIds: { anilistId: "113415" } })).toBe(true);
    expect(isAnimeContent({ externalIds: { malId: "40748" } })).toBe(true);
  });

  test("true when TMDB Animation genre (16) is present", () => {
    expect(isAnimeContent({ genreIds: [16, 10759] })).toBe(true);
  });

  test("false for a live-action drama (no markers)", () => {
    expect(isAnimeContent({ externalIds: { tmdbId: "456" }, genreIds: [18] })).toBe(false);
    expect(isAnimeContent({})).toBe(false);
    expect(isAnimeContent(null)).toBe(false);
  });
});

describe("classifyPersistedKind (content-derived)", () => {
  test("movie wins regardless of mode", () => {
    expect(classifyPersistedKind({ type: "movie" }, "anime")).toBe("movie");
  });

  test("anime mode + drama (no markers) is series, not anime", () => {
    expect(classifyPersistedKind({ type: "series", genreIds: [18] }, "anime")).toBe("series");
  });

  test("anime mode + real anime markers is anime", () => {
    expect(
      classifyPersistedKind({ type: "series", externalIds: { anilistId: "1" } }, "anime"),
    ).toBe("anime");
  });

  test("series mode is always series for tv content", () => {
    expect(
      classifyPersistedKind({ type: "series", externalIds: { anilistId: "1" } }, "series"),
    ).toBe("series");
  });

  test("an anime-only provider stamps anime even with no markers, any mode", () => {
    expect(classifyPersistedKind({ type: "series" }, "series", { providerId: "allanime" })).toBe(
      "anime",
    );
    expect(classifyPersistedKind({ type: "series" }, "anime", { providerId: "miruro" })).toBe(
      "anime",
    );
  });

  test("a non-anime provider does not over-stamp anime", () => {
    expect(classifyPersistedKind({ type: "series" }, "series", { providerId: "vidking" })).toBe(
      "series",
    );
  });
});

describe("correctedHistoryMediaKind (legacy read-time correction)", () => {
  test("keeps movie/series untouched", () => {
    expect(correctedHistoryMediaKind({ mediaKind: "movie" })).toBe("movie");
    expect(correctedHistoryMediaKind({ mediaKind: "series" })).toBe("series");
  });

  test("legacy 'anime' without AniList/MAL id corrects to series", () => {
    expect(correctedHistoryMediaKind({ mediaKind: "anime", externalIds: { tmdbId: "9" } })).toBe(
      "series",
    );
    expect(correctedHistoryMediaKind({ mediaKind: "anime" })).toBe("series");
  });

  test("legacy 'anime' with an AniList/MAL id stays anime", () => {
    expect(correctedHistoryMediaKind({ mediaKind: "anime", externalIds: { malId: "5" } })).toBe(
      "anime",
    );
  });

  test("a row on an anime-only provider is anime even when stored 'series'", () => {
    expect(correctedHistoryMediaKind({ mediaKind: "series", providerId: "allanime" })).toBe(
      "anime",
    );
    expect(correctedHistoryMediaKind({ mediaKind: "series", providerId: "miruro" })).toBe("anime");
  });

  test("a 'series' row with an AniList/MAL id is upgraded to anime (TMDB/series-provider anime)", () => {
    expect(
      correctedHistoryMediaKind({ mediaKind: "series", externalIds: { anilistId: "21" } }),
    ).toBe("anime");
  });

  test("a plain series on a non-anime provider stays series", () => {
    expect(correctedHistoryMediaKind({ mediaKind: "series", providerId: "vidking" })).toBe(
      "series",
    );
  });
});
