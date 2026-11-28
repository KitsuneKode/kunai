import { afterEach, describe, expect, test } from "bun:test";

import { createTmdbDurableCache } from "@/services/catalog/durable-json-cache";
import { clearTmdbSessionCache, setTmdbDurableCache } from "@/services/catalog/tmdb-proxy";
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

function install(handler: (url: string) => Response | Promise<Response>): void {
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => handler(String(input)),
    {
      preconnect: originalFetch.preconnect,
    },
  );
}

const undatedShow = {
  id: 900,
  seasons: [{ season_number: 1, episode_count: 1, name: "Season 1", air_date: "" }],
};

function seasonPayload(name: string) {
  return {
    episodes: [{ episode_number: 1, name, air_date: "2020-01-01", overview: "A real synopsis." }],
  };
}

describe("TMDB season memory cache stays behind a failed or superseded fetch", () => {
  test("a 503 on an undated season is not cached, so recovery shows the season", async () => {
    let seasonUp = false;
    install((url) => {
      if (url.includes("/tv/900/season/1")) {
        return seasonUp
          ? Response.json(seasonPayload("Pilot"))
          : new Response("unavailable", { status: 503 });
      }
      if (url.includes("/tv/900")) return Response.json(undatedShow);
      return new Response("missing", {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    });

    expect(await fetchSeasonSummaries("900")).toEqual([]);
    seasonUp = true;
    clearTmdbSessionCache();
    expect((await fetchSeasonSummaries("900"))?.map((season) => season.number)).toEqual([1]);
  });

  test("a 503 episode fetch is not cached, so recovery shows the episodes", async () => {
    let seasonUp = false;
    install((url) => {
      if (url.includes("/tv/901/season/1")) {
        return seasonUp
          ? Response.json(seasonPayload("Pilot"))
          : new Response("unavailable", { status: 503 });
      }
      return new Response("missing", {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    });

    expect(await fetchEpisodes("901", 1)).toBeNull();
    seasonUp = true;
    clearTmdbSessionCache();
    expect((await fetchEpisodes("901", 1))?.[0]?.name).toBe("Pilot");
  });

  test("a season payload without an episodes array is a failed fetch, not an empty list", async () => {
    let episodesBody: "missing" | "empty" = "missing";
    install((url) => {
      if (!url.includes("/tv/902/season/1")) {
        return new Response("missing", {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      return episodesBody === "missing" ? Response.json({}) : Response.json({ episodes: [] });
    });

    expect(await fetchEpisodes("902", 1)).toBeNull();
    episodesBody = "empty";
    clearTmdbSessionCache();
    clearTmdbMemoryCachesForTest();
    expect(await fetchEpisodes("902", 1)).toEqual([]);
  });

  test("a late episode list does not overwrite a newer one while SQLite holds Fresh", async () => {
    const durable = realCache();
    setTmdbDurableCache(durable);
    const started = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    let phase: "old" | "fresh" = "old";
    install(async (url) => {
      if (!url.includes("/tv/2316/season/1")) {
        return new Response("missing", {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      if (phase === "old") {
        started.resolve();
        await gate.promise;
        return Response.json(seasonPayload("Old"));
      }
      return Response.json(seasonPayload("Fresh"));
    });

    const late = fetchEpisodes("2316", 1);
    await started.promise;
    phase = "fresh";
    clearTmdbSessionCache();
    expect((await fetchEpisodes("2316", 1))?.[0]?.name).toBe("Fresh");
    gate.resolve();
    await late;

    expect((await fetchEpisodes("2316", 1))?.[0]?.name).toBe("Fresh");
    expect(durable.read("/tv/2316/season/1?language=en-US")?.value).toMatchObject({
      episodes: [expect.objectContaining({ name: "Fresh" })],
    });
  });
});
