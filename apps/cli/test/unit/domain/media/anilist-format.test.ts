import { describe, expect, test } from "bun:test";

import {
  contentTypeFromAniListFormat,
  anilistCatalogStructure,
  upgradeContentTypeFromAniListFormat,
} from "@/domain/media/anilist-format";

describe("contentTypeFromAniListFormat", () => {
  test("MOVIE is always a film", () => {
    expect(contentTypeFromAniListFormat("MOVIE")).toBe("movie");
    expect(contentTypeFromAniListFormat("movie", 12)).toBe("movie");
  });

  test("one-shot OVA, SPECIAL, TV_SHORT, and MUSIC are films", () => {
    expect(contentTypeFromAniListFormat("OVA")).toBe("movie");
    expect(contentTypeFromAniListFormat("OVA", 1)).toBe("movie");
    expect(contentTypeFromAniListFormat("SPECIAL", 1)).toBe("movie");
    expect(contentTypeFromAniListFormat("TV_SHORT")).toBe("movie");
    expect(contentTypeFromAniListFormat("MUSIC", 1)).toBe("movie");
  });

  test("multi-episode OVA and SPECIAL stay series", () => {
    expect(contentTypeFromAniListFormat("OVA", 6)).toBe("series");
    expect(contentTypeFromAniListFormat("SPECIAL", 2)).toBe("series");
  });

  test("TV and ONA stay series even with a single aired episode", () => {
    expect(contentTypeFromAniListFormat("TV")).toBe("series");
    expect(contentTypeFromAniListFormat("TV", 1)).toBe("series");
    expect(contentTypeFromAniListFormat("ONA", 1)).toBe("series");
    expect(contentTypeFromAniListFormat("ONA", 12)).toBe("series");
  });

  test("missing or unknown format stays series — never guess a film", () => {
    expect(contentTypeFromAniListFormat(undefined)).toBe("series");
    expect(contentTypeFromAniListFormat("")).toBe("series");
    expect(contentTypeFromAniListFormat("NOVEL")).toBe("series");
  });
});

describe("anilistCatalogStructure", () => {
  test("films drop episode counts and carry runtime seconds", () => {
    expect(anilistCatalogStructure({ format: "MOVIE", episodes: 1, durationMinutes: 155 })).toEqual(
      {
        type: "movie",
        durationSeconds: 9300,
      },
    );
  });

  test("series keep episode counts and omit per-episode duration", () => {
    expect(anilistCatalogStructure({ format: "TV", episodes: 12, durationMinutes: 24 })).toEqual({
      type: "series",
      episodeCount: 12,
    });
  });
});

describe("upgradeContentTypeFromAniListFormat", () => {
  test("upgrades series to movie when catalog format is a film", () => {
    expect(upgradeContentTypeFromAniListFormat("series", "MOVIE")).toBe("movie");
    expect(upgradeContentTypeFromAniListFormat("series", "OVA", 1)).toBe("movie");
  });

  test("never downgrades a film back to series", () => {
    expect(upgradeContentTypeFromAniListFormat("movie", "TV", 12)).toBe("movie");
    expect(upgradeContentTypeFromAniListFormat("movie", undefined)).toBe("movie");
  });
});
