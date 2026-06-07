import { describe, expect, test } from "bun:test";

import { isAnimeLikely } from "@/services/anime-classifier";

describe("isAnimeLikely", () => {
  test("Tier 1: original_language=ja is anime (One Piece, Demon Slayer, Your Name)", () => {
    expect(isAnimeLikely({ original_language: "ja" }).isAnime).toBe(true);
    expect(isAnimeLikely({ original_language: "ja", genre_ids: [16, 10759] }).isAnime).toBe(true);
  });

  test("English US cartoons are NOT anime (Rick & Morty, Simpsons, Avatar TLA)", () => {
    expect(
      isAnimeLikely({ original_language: "en", origin_country: ["US"], genre_ids: [16, 35] })
        .isAnime,
    ).toBe(false);
    expect(isAnimeLikely({ original_language: "en", genre_ids: [16, 10751, 35] }).isAnime).toBe(
      false,
    );
  });

  test("Tier 2: JP origin + Animation genre when language missing", () => {
    expect(
      isAnimeLikely({ origin_country: ["JP"], genre_ids: [16, 10759] }).isAnime,
    ).toBe(true);
    expect(
      isAnimeLikely({ production_countries: [{ iso_3166_1: "JP" }], genre_ids: [16] }).isAnime,
    ).toBe(true);
  });

  test("Tier 3: the TMDB 'anime' keyword (210024)", () => {
    expect(
      isAnimeLikely({ original_language: "en", keywords: [{ id: 210024, name: "anime" }] }).isAnime,
    ).toBe(true);
  });

  test("Tier 4: anime network catches Western-produced anime-style (Rick & Morty: The Anime)", () => {
    expect(
      isAnimeLikely({
        original_language: "en",
        origin_country: ["US"],
        genre_ids: [16, 10765],
        networks: [{ name: "Tokyo MX" }],
      }).isAnime,
    ).toBe(true);
  });

  test("Animation genre alone (no JP signal) is not anime; no signals is not anime", () => {
    expect(isAnimeLikely({ original_language: "en", genre_ids: [16] }).isAnime).toBe(false);
    expect(isAnimeLikely({ original_language: "en", genre_ids: [18, 35] }).isAnime).toBe(false);
  });
});
