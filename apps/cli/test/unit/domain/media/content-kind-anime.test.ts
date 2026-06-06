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
});
