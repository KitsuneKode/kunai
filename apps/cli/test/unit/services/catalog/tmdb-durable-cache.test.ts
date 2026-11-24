import { afterEach, describe, expect, test } from "bun:test";

import { createTmdbDurableCache } from "@/services/catalog/tmdb-durable-cache";
import {
  clearTmdbSessionCache,
  fetchTmdbJsonCached,
  isDurableTmdbPath,
  setTmdbDurableCache,
} from "@/services/catalog/tmdb-proxy";
import { clearTmdbMemoryCachesForTest, fetchEpisodes, fetchSeasonSummaries } from "@/tmdb";
import { openKunaiDatabase, RecommendationCacheRepository, runMigrations } from "@kunai/storage";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  setTmdbDurableCache(null);
  clearTmdbSessionCache();
  clearTmdbMemoryCachesForTest();
});

function realCache() {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "cache");
  return createTmdbDurableCache(new RecommendationCacheRepository(db));
}

function serve(routes: (url: string) => Response | null): void {
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request): Promise<Response> => {
      const response = routes(String(input));
      if (!response) throw new Error("getaddrinfo ENOTFOUND (TMDB down)");
      return response;
    },
    { preconnect: originalFetch.preconnect },
  );
}

const show = {
  id: 2316,
  seasons: [
    { season_number: 1, episode_count: 6, name: "Season 1", air_date: "2005-03-24" },
    { season_number: 4, episode_count: 14, name: "Season 4", air_date: "2007-09-27" },
  ],
};
const season4 = {
  episodes: [{ episode_number: 5, name: "Local Ad", air_date: "2007-10-25", overview: "x" }],
};

describe("TMDB last-known-good for series structure", () => {
  test("only show and season responses are saved", () => {
    expect(isDurableTmdbPath("/tv/2316")).toBe(true);
    expect(isDurableTmdbPath("/tv/2316?language=en-US")).toBe(true);
    expect(isDurableTmdbPath("/tv/2316/season/4?language=en-US")).toBe(true);
    expect(isDurableTmdbPath("/search/tv?query=office")).toBe(false);
    expect(isDurableTmdbPath("/trending/all/week")).toBe(false);
    expect(isDurableTmdbPath("/tv/2316/recommendations")).toBe(false);
  });

  test("with every TMDB host down, a series opened before still lists seasons and episodes with TMDB numbering", async () => {
    setTmdbDurableCache(realCache());
    serve((url) => {
      if (url.includes("/tv/2316/season/4")) return Response.json(season4);
      if (url.includes("/tv/2316")) return Response.json(show);
      return null;
    });
    expect(
      (await fetchEpisodes("2316", 4))?.map((episode) => `${episode.number} ${episode.name}`),
    ).toEqual(["5 Local Ad"]);
    await fetchSeasonSummaries("2316");

    // New process, TMDB unreachable everywhere.
    clearTmdbSessionCache();
    clearTmdbMemoryCachesForTest();
    serve(() => null);
    expect((await fetchSeasonSummaries("2316"))?.map((season) => season.number)).toEqual([1, 4]);
    expect((await fetchEpisodes("2316", 4))?.[0]).toMatchObject({ number: 5, name: "Local Ad" });
  });

  test("a definitive 4xx is TMDB's answer and is never masked by a saved copy", async () => {
    setTmdbDurableCache(realCache());
    serve(() => Response.json(show));
    await fetchTmdbJsonCached("/tv/2316");
    clearTmdbSessionCache();
    serve(() => new Response("{}", { status: 404 }));
    await expect(fetchTmdbJsonCached("/tv/2316")).rejects.toThrow("404");
  });

  test("no saved copy: the outage error propagates as before", async () => {
    setTmdbDurableCache(realCache());
    serve(() => null);
    await expect(fetchTmdbJsonCached("/tv/1")).rejects.toThrow();
  });
});
