import { describe, expect, test } from "bun:test";

import { normalizeSearchIntent } from "@/domain/search/SearchIntent";
import { buildVideasyDiscoverUrls } from "@/search";
import { buildAniListSearchRequest } from "@/services/search/definitions/anilist";

describe("advanced search builders", () => {
  test("builds queryless TMDB discover URLs from structured filters", () => {
    const urls = buildVideasyDiscoverUrls(
      normalizeSearchIntent({
        query: "",
        mode: "series",
        filters: { type: "series", genres: ["drama"], minRating: 8, year: 2024 },
        sort: "popular",
      }),
    );

    expect(urls).toHaveLength(1);
    expect(urls[0]?.type).toBe("series");
    expect(urls[0]?.url).toContain("/discover/tv?");
    expect(urls[0]?.url).toContain("with_genres=18");
    expect(urls[0]?.url).toContain("vote_average.gte=8");
    expect(urls[0]?.url).toContain("first_air_date_year=2024");
    expect(urls[0]?.url).toContain("sort_by=popularity.desc");
  });

  test("keeps text TMDB search on the existing search endpoint", () => {
    const urls = buildVideasyDiscoverUrls(
      normalizeSearchIntent({
        query: "Dune",
        mode: "series",
        filters: { genres: ["sci-fi"] },
      }),
    );

    expect(urls).toEqual([]);
  });

  test("builds AniList GraphQL variables from anime filters", () => {
    const request = buildAniListSearchRequest(
      normalizeSearchIntent({
        query: "",
        mode: "anime",
        filters: { genres: ["slice-of-life"], minRating: 7.5, year: 2022 },
        sort: "rating",
      }),
    );

    expect(request.variables).toEqual({
      page: 1,
      sort: ["SCORE_DESC"],
      genre: "Slice Of Life",
      score: 75,
      seasonYear: 2022,
    });
  });
});
