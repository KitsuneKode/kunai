import { afterEach, describe, expect, setSystemTime, test } from "bun:test";

import type { SearchResult } from "@/domain/types";
import { clearTmdbSessionCache } from "@/services/catalog/tmdb-proxy";
import {
  buildRecommendCacheKey,
  isCacheExpired,
  RECOMMENDATION_STALE_RETENTION_MS,
  RecommendationServiceImpl,
} from "@/services/recommendations/RecommendationServiceImpl";
import { openKunaiDatabase, RecommendationCacheRepository, runMigrations } from "@kunai/storage";

// The host-breaker chain in tmdb-proxy keeps per-host failure state across
// tests in this file — a 503 stub would otherwise poison every later case.
afterEach(() => {
  clearTmdbSessionCache();
  setSystemTime();
});

describe("recommendation cache", () => {
  test("buildRecommendCacheKey includes id and type", () => {
    const key = buildRecommendCacheKey("438631", "movie");
    expect(key).toBe("recommend:movie:438631");
  });

  test("buildRecommendCacheKey uses 'trending' for trending section", () => {
    const key = buildRecommendCacheKey("trending", "trending");
    expect(key).toBe("recommend:trending:trending");
  });

  test("isCacheExpired returns true when cachedAt is older than ttl", () => {
    const old = Date.now() - 25 * 60 * 60 * 1000;
    expect(isCacheExpired(old, 24 * 60 * 60 * 1000)).toBe(true);
  });

  test("isCacheExpired returns false when cachedAt is within ttl", () => {
    const recent = Date.now() - 1 * 60 * 60 * 1000;
    expect(isCacheExpired(recent, 24 * 60 * 60 * 1000)).toBe(false);
  });

  test("getTrending does not cache an empty section when upstream fetches fail", async () => {
    const originalFetch = globalThis.fetch;
    const cache = createRecommendationCacheDouble();
    globalThis.fetch = createFetchDouble(async () => new Response("{}", { status: 503 }));

    try {
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
      const service = new RecommendationServiceImpl(cache as never);
      const section = await service.getTrending();

      expect(section.items).toEqual([]);
      expect(cache.setCalls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("getForTitle does not cache an empty section when upstream fetches fail", async () => {
    const originalFetch = globalThis.fetch;
    const cache = createRecommendationCacheDouble();
    globalThis.fetch = createFetchDouble(async () => new Response("{}", { status: 503 }));

    try {
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
      const service = new RecommendationServiceImpl(cache as never);
      const section = await service.getForTitle("438631", "movie");

      expect(section.items).toEqual([]);
      expect(cache.setCalls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("getTrending caches a successful empty upstream response", async () => {
    const originalFetch = globalThis.fetch;
    const cache = createRecommendationCacheDouble();
    globalThis.fetch = createFetchDouble(
      async () =>
        new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    try {
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
      const service = new RecommendationServiceImpl(cache as never);
      const section = await service.getTrending();

      expect(section.items).toEqual([]);
      expect(cache.setCalls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("getPersonalizedByHistory resolves numeric titleId without title search", async () => {
    const originalFetch = globalThis.fetch;
    const cache = createRecommendationCacheDouble();
    let fetchCount = 0;
    globalThis.fetch = createFetchDouble(async (input) => {
      fetchCount += 1;
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/tv/1396")) {
        return new Response(JSON.stringify({ genres: [{ id: 18 }, { id: 80 }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/discover/")) {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 999,
                name: "Better Call Saul",
                first_air_date: "2015-02-08",
                genre_ids: [18],
                vote_average: 8.7,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 404 });
    });

    try {
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
      const service = new RecommendationServiceImpl(cache as never);
      const section = await service.getPersonalizedByHistory([
        {
          titleId: "1396",
          title: "Breaking Bad",
          type: "series",
          watchedAt: new Date().toISOString(),
        },
      ]);

      expect(section.items.length).toBeGreaterThan(0);
      expect(fetchCount).toBeLessThanOrEqual(3);
      expect(fetchCount).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("getForTitle returns stale cached recommendations when upstream refresh fails", async () => {
    const originalFetch = globalThis.fetch;
    const staleItem = {
      id: "stale-1",
      type: "movie",
      title: "Still Useful",
      year: "2024",
      overview: "",
      posterPath: null,
    } satisfies SearchResult;
    const cache = createRecommendationCacheDouble({
      payloadJson: JSON.stringify({
        cachedAt: Date.now() - 48 * 60 * 60 * 1000,
        items: [staleItem],
      }),
    });
    globalThis.fetch = createFetchDouble(async () => new Response("{}", { status: 503 }));

    try {
      // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
      const service = new RecommendationServiceImpl(cache as never);
      const section = await service.getForTitle("438631", "movie");

      expect(section.items).toEqual([staleItem]);
      expect(cache.setCalls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("recommendation cache against the real SQLite repository", () => {
  // The double above never expires rows, which is how the original bug hid: the
  // real repository deletes a row on read once `expires_at` passes, so tying
  // row expiry to the freshness TTL made every "stale fallback" read empty.
  function realRepository() {
    const db = openKunaiDatabase(":memory:");
    runMigrations(db, "cache");
    return new RecommendationCacheRepository(db);
  }
  const trendingPayload = {
    results: [{ id: 1, media_type: "movie", title: "Dune", release_date: "2021-09-15" }],
  };

  test("trending survives an outage longer than its freshness TTL, labelled stale", async () => {
    const originalFetch = globalThis.fetch;
    const start = Date.parse("2026-11-23T00:00:00.000Z");
    setSystemTime(new Date(start));
    const service = new RecommendationServiceImpl(realRepository());
    try {
      globalThis.fetch = createFetchDouble(async () => Response.json(trendingPayload));
      const fresh = await service.getTrending();
      expect(fresh.items.map((item) => item.title)).toEqual(["Dune"]);
      expect(fresh.staleSince).toBeUndefined();

      // Seven hours later (past the 6 h TTL) TMDB is down.
      clearTmdbSessionCache();
      setSystemTime(new Date(start + 7 * 60 * 60 * 1000));
      globalThis.fetch = createFetchDouble(async () => new Response("{}", { status: 503 }));
      const stale = await service.getTrending();
      expect(stale.items.map((item) => item.title)).toEqual(["Dune"]);
      expect(stale.staleSince).toBe(start);

      // Past the retention window the last good answer is finally gone.
      clearTmdbSessionCache();
      setSystemTime(new Date(start + RECOMMENDATION_STALE_RETENTION_MS + 60_000));
      expect((await service.getTrending()).items).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a failed personalized refresh never overwrites the last good answer with nothing", async () => {
    const originalFetch = globalThis.fetch;
    const start = Date.parse("2026-11-23T00:00:00.000Z");
    setSystemTime(new Date(start));
    const repository = realRepository();
    const service = new RecommendationServiceImpl(repository);
    const seed = [
      {
        title: "Arrival",
        type: "movie" as const,
        titleId: "329865",
        watchedAt: "2026-11-20T00:00:00.000Z",
      },
    ];
    try {
      globalThis.fetch = createFetchDouble(async (input) => {
        const url = String(input);
        if (url.includes("/movie/329865")) return Response.json({ genres: [{ id: 878 }] });
        if (url.includes("/discover/tv")) return Response.json({ results: [] });
        if (url.includes("/discover/movie")) {
          return Response.json({
            results: [
              { id: 2, title: "Interstellar", release_date: "2014-11-05", genre_ids: [878] },
            ],
          });
        }
        return new Response("{}", { status: 404 });
      });
      const first = await service.getPersonalizedByHistory(seed);
      expect(first.items.map((item) => item.title)).toEqual(["Interstellar"]);

      clearTmdbSessionCache();
      setSystemTime(new Date(start + 25 * 60 * 60 * 1000));
      globalThis.fetch = createFetchDouble(async (input) => {
        const url = String(input);
        if (url.includes("/movie/329865")) return Response.json({ genres: [{ id: 878 }] });
        return new Response("{}", { status: 503 });
      });
      const second = await service.getPersonalizedByHistory(seed);
      expect(second.items.map((item) => item.title)).toEqual(["Interstellar"]);
      expect(second.staleSince).toBe(start);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

type FetchHandler = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

function createFetchDouble(handler: FetchHandler): typeof fetch {
  return Object.assign(handler, {
    preconnect: globalThis.fetch.preconnect,
  });
}

function createRecommendationCacheDouble(entry?: { payloadJson: string }) {
  return {
    setCalls: 0,
    get() {
      return entry;
    },
    set() {
      this.setCalls += 1;
    },
    clear() {},
  };
}
