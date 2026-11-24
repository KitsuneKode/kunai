import { afterEach, describe, expect, setSystemTime, test } from "bun:test";

import type { SearchResult } from "@/domain/types";
import {
  catalogAnswersSnapshot,
  recordCatalogAnswer,
} from "@/services/catalog/catalog-source-ledger";
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
  test("a fresh cached answer is recorded as TMDB, replacing an earlier fallback record", async () => {
    const db = openKunaiDatabase(":memory:");
    runMigrations(db, "cache");
    const repository = new RecommendationCacheRepository(db);
    const items: SearchResult[] = [
      { id: "1", type: "movie", title: "Cached", year: "2026", overview: "", posterPath: null },
    ];
    repository.set(
      buildRecommendCacheKey("trending", "trending"),
      JSON.stringify({ cachedAt: Date.now(), items }),
      new Date(Date.now() + RECOMMENDATION_STALE_RETENTION_MS).toISOString(),
      new Date().toISOString(),
    );
    recordCatalogAnswer({
      capability: "recommendations",
      lane: "movie-series",
      sourceId: "saved",
      sourceName: "saved list",
      fallback: true,
      reason: "TMDB unreachable",
    });
    const section = await new RecommendationServiceImpl(repository).getTrending();
    expect(section.items.map((entry) => entry.id)).toEqual(["1"]);
    expect(catalogAnswersSnapshot()).toMatchObject([{ sourceId: "tmdb", fallback: false }]);
    db.close();
  });

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

describe("refresh, malformed rows and malformed answers", () => {
  function realRepository() {
    const db = openKunaiDatabase(":memory:");
    runMigrations(db, "cache");
    return new RecommendationCacheRepository(db);
  }
  const ok = {
    results: [{ id: 1, media_type: "movie", title: "Dune", release_date: "2021-09-15" }],
  };

  test("a user refresh forces a live request but keeps the fallback rows", async () => {
    const originalFetch = globalThis.fetch;
    const repository = realRepository();
    const service = new RecommendationServiceImpl(repository);
    let calls = 0;
    try {
      globalThis.fetch = createFetchDouble(async () => {
        calls += 1;
        return Response.json(ok);
      });
      await service.getTrending();
      await service.getTrending();
      expect(calls).toBe(1);

      // Discover refresh, then TMDB is down: the refresh must not have
      // deleted the row the outage now needs.
      await service.clearCache();
      globalThis.fetch = createFetchDouble(async () => {
        calls += 1;
        return new Response("{}", { status: 503 });
      });
      const afterRefresh = await service.getTrending();
      // The refresh bypassed the fresh row and tried TMDB (every host).
      expect(calls).toBeGreaterThan(1);
      expect(afterRefresh.items.map((item) => item.title)).toEqual(["Dune"]);
      expect(afterRefresh.staleSince).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a damaged row is ignored instead of crashing the rail", async () => {
    const originalFetch = globalThis.fetch;
    const repository = realRepository();
    repository.set(
      buildRecommendCacheKey("trending", "trending"),
      JSON.stringify({ cachedAt: 1, items: [null, { id: "x" }] }),
      new Date(Date.now() + 86_400_000).toISOString(),
      new Date().toISOString(),
    );
    try {
      globalThis.fetch = createFetchDouble(async () => new Response("{}", { status: 503 }));
      const section = await new RecommendationServiceImpl(repository).getTrending();
      expect(section.items).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a 200 without a results array does not overwrite the last good answer", async () => {
    const originalFetch = globalThis.fetch;
    const repository = realRepository();
    const service = new RecommendationServiceImpl(repository);
    try {
      globalThis.fetch = createFetchDouble(async () => Response.json(ok));
      await service.getForTitle("438631", "movie");
      await service.clearCache();
      globalThis.fetch = createFetchDouble(async () => Response.json({ status_message: "oops" }));
      const section = await service.getForTitle("438631", "movie");
      expect(section.items.map((item) => item.title)).toEqual(["Dune"]);
      expect(section.staleSince).toBeDefined();
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
