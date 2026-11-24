import { afterEach, describe, expect, test } from "bun:test";

import { catalogAnswersSnapshot } from "@/services/catalog/catalog-source-ledger";
import { createTmdbDurableCache } from "@/services/catalog/durable-json-cache";
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
    // /diagnostics can say the episode list came from the saved copy.
    expect(catalogAnswersSnapshot()).toMatchObject([
      { capability: "series-episodes", sourceId: "saved", fallback: true },
    ]);
  });

  test("a show-only request (genres for recommendations) does not speak for the episode source", async () => {
    setTmdbDurableCache(realCache());
    serve(() => Response.json(show));
    await fetchTmdbJsonCached("/tv/2316");
    expect(catalogAnswersSnapshot()).toEqual([]);
    serve(() => Response.json(season4));
    await fetchTmdbJsonCached("/tv/2316/season/4?language=en-US");
    expect(catalogAnswersSnapshot()).toMatchObject([
      { capability: "series-episodes", sourceId: "tmdb", fallback: false },
    ]);
  });

  test("a 429 is temporary: the next host answers", async () => {
    setTmdbDurableCache(realCache());
    let first = true;
    serve(() => {
      if (first) {
        first = false;
        return new Response("slow down", { status: 429 });
      }
      return Response.json(show);
    });
    expect(await fetchTmdbJsonCached("/tv/2316")).toEqual(show);
  });

  test("every host rate limited: the saved copy answers instead of an error", async () => {
    setTmdbDurableCache(realCache());
    serve(() => Response.json(show));
    await fetchTmdbJsonCached("/tv/2316");
    clearTmdbSessionCache();
    serve(() => new Response("slow down", { status: 429 }));
    expect(await fetchTmdbJsonCached("/tv/2316")).toEqual(show);
  });

  test("rate-limited hosts are not re-probed before their rest ends", async () => {
    setTmdbDurableCache(realCache());
    let requests = 0;
    serve(() => {
      requests += 1;
      return new Response("slow down", { status: 429 });
    });
    await expect(fetchTmdbJsonCached("/tv/9999")).rejects.toThrow();
    const afterFirst = requests;
    // A different request inside the rest: no host is asked again.
    await expect(fetchTmdbJsonCached("/tv/9998")).rejects.toThrow("rate limited");
    expect(requests).toBe(afterFirst);
  });

  test("a mirror's HTTP 200 error payload never replaces a good saved show", async () => {
    setTmdbDurableCache(realCache());
    serve(() => Response.json(show));
    await fetchTmdbJsonCached("/tv/2316");
    clearTmdbSessionCache();
    // Every host answers 200 with TMDB's error envelope: a failure, not data.
    serve(() => Response.json({ success: false, status_code: 34, status_message: "not found" }));
    expect(await fetchTmdbJsonCached("/tv/2316")).toEqual(show);
    clearTmdbSessionCache();
    serve(() => null);
    // The saved copy is still the good show, not the error object.
    expect(await fetchTmdbJsonCached("/tv/2316")).toEqual(show);
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
