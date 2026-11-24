import { afterEach, describe, expect, test } from "bun:test";

import { CatalogScheduleService } from "@/services/catalog/CatalogScheduleService";
import { clearSeriesHintsForTest, rememberSeriesHint } from "@/services/catalog/series-hints";
import { clearTmdbSessionCache } from "@/services/catalog/tmdb-proxy";
import {
  fetchTvmazeEpisodes,
  resetTvmazeClientForTest,
  resolveTvmazeShowId,
  TvmazeUnavailableError,
} from "@/services/catalog/tvmaze-client";
import { clearTmdbMemoryCachesForTest, fetchEpisodes, fetchSeasonSummaries } from "@/tmdb";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetTvmazeClientForTest();
  clearSeriesHintsForTest();
  clearTmdbSessionCache();
  clearTmdbMemoryCachesForTest();
});

const severance = {
  id: 44933,
  name: "Severance",
  premiered: "2022-02-18",
  externals: { imdb: "tt11280740" },
};
const episodes = [
  {
    season: 1,
    number: 1,
    name: "Good News About Hell",
    airdate: "2022-02-18",
    runtime: 57,
    type: "regular",
    summary: "<p>Mark is promoted.</p>",
    image: { medium: "https://static.tvmaze.com/e1.jpg" },
  },
  {
    season: 1,
    number: 2,
    name: "Half Loop",
    airdate: "2022-02-18",
    runtime: 53,
    type: "regular",
    summary: "",
    image: null,
  },
  {
    season: 1,
    number: null,
    name: "Behind the scenes",
    airdate: "2022-03-01",
    type: "insignificant_special",
  },
  {
    season: 2,
    number: 1,
    name: "Hello, Ms. Cobel",
    airdate: "2025-01-17",
    runtime: 55,
    type: "regular",
    summary: "",
  },
  { season: 3, number: 1, name: "Future", airdate: "2999-01-01", type: "regular", summary: "" },
];

/** TMDB hosts all fail; TVmaze answers from the fixtures. Returns the URLs requested. */
function tmdbDownTvmazeUp(): string[] {
  const urls: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      urls.push(url);
      if (!url.startsWith("https://api.tvmaze.com")) throw new Error("getaddrinfo ENOTFOUND tmdb");
      if (url.includes("/lookup/shows?imdb=tt11280740")) return Response.json(severance);
      if (url.includes("/singlesearch/shows")) return Response.json(severance);
      if (url.includes("/shows/44933/episodes")) return Response.json(episodes);
      return new Response("{}", { status: 404 });
    },
    { preconnect: originalFetch.preconnect },
  );
  return urls;
}

describe("TVmaze client", () => {
  test("an IMDb id resolves exactly; a name needs a matching premiere year", async () => {
    tmdbDownTvmazeUp();
    expect(await resolveTvmazeShowId({ name: "anything", imdbId: "tt11280740" })).toBe(44933);
    expect(await resolveTvmazeShowId({ name: "Severance", year: "2022" })).toBe(44933);
    // Same name, wrong year: a different show, so no fallback rather than a wrong one.
    expect(await resolveTvmazeShowId({ name: "Severance", year: "2010" })).toBeNull();
    // No year: only an exact (normalised) name is trusted.
    expect(await resolveTvmazeShowId({ name: "severance!" })).toBe(44933);
    expect(await resolveTvmazeShowId({ name: "Severence" })).toBeNull();
  });

  test("specials are dropped and HTML summaries are stripped", async () => {
    tmdbDownTvmazeUp();
    const rows = await fetchTvmazeEpisodes(44933);
    expect(rows.map((row) => `${row.season}x${row.number}`)).toEqual(["1x1", "1x2", "2x1", "3x1"]);
    expect(rows[0]?.summary).toBe("Mark is promoted.");
    expect(rows[0]?.imageUrl).toBe("https://static.tvmaze.com/e1.jpg");
  });

  test("an unreachable TVmaze is skipped for a while instead of costing its timeout again", async () => {
    let calls = 0;
    globalThis.fetch = Object.assign(
      async () => {
        calls += 1;
        throw new Error("connect ETIMEDOUT");
      },
      { preconnect: originalFetch.preconnect },
    );
    await expect(fetchTvmazeEpisodes(1)).rejects.toBeInstanceOf(TvmazeUnavailableError);
    await expect(fetchTvmazeEpisodes(2)).rejects.toThrow("recently unreachable");
    expect(calls).toBe(1);
  });
});

describe("TMDB episode lists fall back to TVmaze", () => {
  test("with every TMDB host down, a selected series still lists its aired seasons and episodes", async () => {
    tmdbDownTvmazeUp();
    rememberSeriesHint("95396", { name: "Severance", year: "2022", imdbId: "tt11280740" });

    const seasons = await fetchSeasonSummaries("95396");
    // Season 3 has not aired yet, so it is not offered.
    expect(seasons?.map((season) => season.number)).toEqual([1, 2]);

    const season1 = await fetchEpisodes("95396", 1);
    expect(season1?.map((episode) => episode.name)).toEqual(["Good News About Hell", "Half Loop"]);
    expect(season1?.[0]?.runtimeMinutes).toBe(57);
  });

  test("without a hint there is nothing to identify the show by: null, as before", async () => {
    tmdbDownTvmazeUp();
    expect(await fetchSeasonSummaries("95396")).toBeNull();
    expect(await fetchEpisodes("95396", 1)).toBeNull();
  });

  test("a recovered TMDB wins: TVmaze answers are not cached as TMDB data", async () => {
    tmdbDownTvmazeUp();
    rememberSeriesHint("95396", { name: "Severance", year: "2022", imdbId: "tt11280740" });
    expect((await fetchEpisodes("95396", 1))?.[0]?.name).toBe("Good News About Hell");

    clearTmdbSessionCache();
    globalThis.fetch = Object.assign(
      async () =>
        Response.json({
          episodes: [
            { episode_number: 1, name: "TMDB title", air_date: "2022-02-18", overview: "x" },
          ],
        }),
      { preconnect: originalFetch.preconnect },
    );
    expect((await fetchEpisodes("95396", 1))?.[0]?.name).toBe("TMDB title");
  });
});

describe("followed-series release info falls back to TVmaze", () => {
  test("with TMDB down, the next episode of a followed series still resolves by title", async () => {
    tmdbDownTvmazeUp();
    const service = new CatalogScheduleService(undefined, () =>
      Date.parse("2026-11-24T00:00:00.000Z"),
    );
    const next = await service.getNextRelease({
      source: "tmdb",
      titleId: "95396",
      titleName: "Severance",
      type: "series",
      season: 2,
      episode: 1,
    });
    expect(next?.episodeTitle).toBe("Hello, Ms. Cobel");
    expect(next?.releaseAt).toBe("2025-01-17");
    // The entry stays keyed by the TMDB id; nothing downstream sees a TVmaze id.
    expect(next?.titleId).toBe("95396");
  });
});
