import { describe, expect, test } from "bun:test";

import { normalizeSearchIntent } from "@/domain/search/SearchIntent";
import { buildVideasyDiscoverPlan, buildVideasyDiscoverUrls, discoverVideasy } from "@/search";
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

  test("reports only the TMDB filters that can actually be pushed upstream", () => {
    const plan = buildVideasyDiscoverPlan(
      normalizeSearchIntent({
        query: "",
        mode: "series",
        filters: { genres: ["drama", "slice-of-life"], minRating: 8, year: 2024 },
        sort: "popular",
      }),
    );

    expect(plan.urls).toHaveLength(1);
    expect(plan.evidence).toEqual({
      upstream: ["type", "genre:drama", "rating", "year", "sort"],
      unsupported: ["genre:slice-of-life"],
    });
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
      genres: ["Slice Of Life"],
      score: 75,
      seasonYear: 2022,
    });
  });

  test("pushes multiple AniList genres with genre_in", () => {
    const request = buildAniListSearchRequest(
      normalizeSearchIntent({
        query: "",
        mode: "anime",
        filters: { genres: ["action", "slice-of-life"] },
      }),
    );

    expect(request.variables.genres).toEqual(["Action", "Slice Of Life"]);
    expect(request.query).toContain("genre_in:$genres");
  });

  test("returns partial TMDB discover results when one discover endpoint fails", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) throw new Error("movie endpoint down");
      return new Response(
        JSON.stringify({
          results: [
            {
              id: 10,
              media_type: "tv",
              name: "Still Available",
              first_air_date: "2024-01-01",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    try {
      const results = await discoverVideasy(
        normalizeSearchIntent({
          query: "",
          mode: "all",
          filters: { genres: ["drama"] },
        }),
      );

      expect(results.map((result) => result.id)).toEqual(["10"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
