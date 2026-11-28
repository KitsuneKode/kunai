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

describe("a late recommendation write cannot undo a refresh", () => {
  const frozen = Date.parse("2026-11-28T12:00:00.000Z");

  function repository() {
    const db = openKunaiDatabase(":memory:");
    runMigrations(db, "cache");
    return new RecommendationCacheRepository(db);
  }

  function titled(title: string, id: number) {
    return {
      id,
      media_type: "movie",
      title,
      release_date: "2020-01-01",
      genre_ids: [18],
    };
  }

  /**
   * Holds every matching request that starts before `useFresh` until `release`.
   * The clock stays frozen, so a timestamp freshness check cannot tell the
   * refresh's row from the late one.
   */
  function phasedFetch(input: {
    readonly hangWhen: (url: string) => boolean;
    readonly respond: (url: string, phase: "old" | "fresh") => Response;
  }) {
    const started = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    let phase: "old" | "fresh" = "old";
    globalThis.fetch = createFetchDouble(async (request) => {
      const url = String(request);
      if (phase === "old" && input.hangWhen(url)) {
        started.resolve();
        await gate.promise;
        return input.respond(url, "old");
      }
      return input.respond(url, phase);
    });
    return {
      started: started.promise,
      release: () => gate.resolve(),
      useFresh: () => {
        phase = "fresh";
      },
    };
  }

  async function expectRefreshWins(input: {
    readonly key: string;
    readonly hangWhen: (url: string) => boolean;
    readonly respond: (url: string, phase: "old" | "fresh") => Response;
    readonly load: (
      service: RecommendationServiceImpl,
    ) => Promise<{ items: readonly { title: string }[] }>;
  }): Promise<void> {
    const originalFetch = globalThis.fetch;
    setSystemTime(new Date(frozen));
    const store = repository();
    const service = new RecommendationServiceImpl(store);
    const fetchPhase = phasedFetch(input);
    try {
      const late = input.load(service);
      await fetchPhase.started;
      fetchPhase.useFresh();
      await service.clearCache();
      const refreshed = await input.load(service);
      expect(refreshed.items[0]?.title).toBe("Fresh");
      fetchPhase.release();
      await late;

      const stored = store.get(input.key);
      expect(stored).toBeDefined();
      expect(JSON.parse(stored?.payloadJson ?? "{}")).toMatchObject({
        items: [expect.objectContaining({ title: "Fresh" })],
      });

      let leaked = 0;
      globalThis.fetch = createFetchDouble(async () => {
        leaked += 1;
        return new Response("{}", { status: 503 });
      });
      const again = await input.load(service);
      expect(again.items[0]?.title).toBe("Fresh");
      expect(leaked).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  test("getForTitle keeps the refresh when a pre-refresh request settles late", async () => {
    await expectRefreshWins({
      key: buildRecommendCacheKey("438631", "movie"),
      hangWhen: () => true,
      respond: (_url, phase) =>
        Response.json({
          results: [titled(phase === "old" ? "Old" : "Fresh", phase === "old" ? 1 : 2)],
        }),
      load: (service) => service.getForTitle("438631", "movie"),
    });
  });

  test("getTrending keeps the refresh when a pre-refresh request settles late", async () => {
    await expectRefreshWins({
      key: buildRecommendCacheKey("trending", "trending"),
      hangWhen: () => true,
      respond: (_url, phase) =>
        Response.json({
          results: [titled(phase === "old" ? "Old" : "Fresh", phase === "old" ? 1 : 2)],
        }),
      load: (service) => service.getTrending(),
    });
  });

  test("getPersonalizedByHistory keeps the refresh when a pre-refresh request settles late", async () => {
    const seed = [
      {
        title: "Arrival",
        type: "movie" as const,
        titleId: "329865",
        watchedAt: "2026-11-20T00:00:00.000Z",
      },
    ];
    await expectRefreshWins({
      key: buildRecommendCacheKey("movie:329865", "genre-affinity"),
      hangWhen: (url) => url.includes("/discover/"),
      respond: (url, phase) => {
        if (url.includes("/movie/329865")) return Response.json({ genres: [{ id: 18 }] });
        if (url.includes("/discover/tv")) return Response.json({ results: [] });
        return Response.json({
          results: [titled(phase === "old" ? "Old" : "Fresh", phase === "old" ? 1 : 2)],
        });
      },
      load: (service) => service.getPersonalizedByHistory(seed),
    });
  });

  test("getGenreAffinity keeps the refresh when a pre-refresh request settles late", async () => {
    await expectRefreshWins({
      key: buildRecommendCacheKey("18", "genre-affinity"),
      hangWhen: (url) => url.includes("/discover/"),
      respond: (url, phase) => {
        if (url.includes("/discover/tv")) return Response.json({ results: [] });
        return Response.json({
          results: [titled(phase === "old" ? "Old" : "Fresh", phase === "old" ? 1 : 2)],
        });
      },
      load: (service) => service.getGenreAffinity([18]),
    });
  });

  test("an aborted getForTitle does not cache the response that arrives afterwards", async () => {
    const originalFetch = globalThis.fetch;
    setSystemTime(new Date(frozen));
    const store = repository();
    const service = new RecommendationServiceImpl(store);
    const controller = new AbortController();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<Response>();
    globalThis.fetch = createFetchDouble(async () => {
      started.resolve();
      return release.promise;
    });
    try {
      const pending = service.getForTitle("438631", "movie", controller.signal);
      await started.promise;
      controller.abort();
      release.resolve(Response.json({ results: [titled("Should Not Stick", 9)] }));
      await pending;
      expect(store.get(buildRecommendCacheKey("438631", "movie"))).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a discover call that loses the movie or tv half is not cached for the freshness window", async () => {
    const originalFetch = globalThis.fetch;
    setSystemTime(new Date(frozen));
    const store = repository();
    const service = new RecommendationServiceImpl(store);
    let movieDown = true;
    const seed = [
      {
        title: "Arrival",
        type: "movie" as const,
        titleId: "329865",
        watchedAt: "2026-11-20T00:00:00.000Z",
      },
    ];
    globalThis.fetch = createFetchDouble(async (request) => {
      const url = String(request);
      if (url.includes("/movie/329865")) return Response.json({ genres: [{ id: 18 }] });
      if (url.includes("/discover/movie") || url.includes("/recommendations")) {
        return movieDown
          ? new Response("{}", { status: 503 })
          : Response.json({ results: [titled("Movie Hit", 3)] });
      }
      if (url.includes("/discover/tv")) return Response.json({ results: [titled("TV Hit", 4)] });
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    });
    try {
      const affinityKey = buildRecommendCacheKey("18", "genre-affinity");
      const partialAffinity = await service.getGenreAffinity([18]);
      expect(partialAffinity.items.map((item) => item.title)).toEqual(["TV Hit"]);
      expect(store.get(affinityKey)).toBeUndefined();

      const historyKey = buildRecommendCacheKey("movie:329865", "genre-affinity");
      const partialHistory = await service.getPersonalizedByHistory(seed);
      expect(partialHistory.items.map((item) => item.title)).toEqual(["TV Hit"]);
      expect(store.get(historyKey)).toBeUndefined();

      movieDown = false;
      clearTmdbSessionCache();
      const full = await service.getGenreAffinity([18]);
      expect(full.items.map((item) => item.title).sort()).toEqual(["Movie Hit", "TV Hit"]);
      expect(store.get(affinityKey)).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("another process's refresh does not treat a row written before that refresh as fresh", async () => {
    const originalFetch = globalThis.fetch;
    setSystemTime(new Date(frozen));
    const store = repository();
    const serviceA = new RecommendationServiceImpl(store);
    const serviceB = new RecommendationServiceImpl(store);
    globalThis.fetch = createFetchDouble(async () =>
      Response.json({ results: [titled("Old", 1)] }),
    );
    try {
      await serviceA.clearCache();
      expect((await serviceA.getTrending()).items[0]?.title).toBe("Old");
      clearTmdbSessionCache();
      await serviceB.clearCache();
      let calls = 0;
      globalThis.fetch = createFetchDouble(async () => {
        calls += 1;
        return Response.json({ results: [titled("Fresh", 2)] });
      });
      const loaded = await serviceB.getTrending();
      expect(loaded.items[0]?.title).toBe("Fresh");
      expect(calls).toBeGreaterThan(0);
      const stored = store.get(buildRecommendCacheKey("trending", "trending"));
      expect(JSON.parse(stored?.payloadJson ?? "{}")).toMatchObject({
        items: [expect.objectContaining({ title: "Fresh" })],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a process that has not refreshed still serves a TTL-valid row without fetching", async () => {
    const originalFetch = globalThis.fetch;
    setSystemTime(new Date(frozen));
    const store = repository();
    const serviceA = new RecommendationServiceImpl(store);
    globalThis.fetch = createFetchDouble(async () =>
      Response.json({ results: [titled("Cached", 1)] }),
    );
    try {
      await serviceA.clearCache();
      expect((await serviceA.getTrending()).items[0]?.title).toBe("Cached");
      clearTmdbSessionCache();
      let calls = 0;
      globalThis.fetch = createFetchDouble(async () => {
        calls += 1;
        return new Response("{}", { status: 503 });
      });
      const serviceB = new RecommendationServiceImpl(store);
      const loaded = await serviceB.getTrending();
      expect(loaded.items[0]?.title).toBe("Cached");
      expect(loaded.staleSince).toBeUndefined();
      expect(calls).toBe(0);

      store.set(
        buildRecommendCacheKey("trending", "trending"),
        JSON.stringify({
          cachedAt: frozen,
          items: [
            {
              id: "3",
              type: "movie",
              title: "Legacy",
              year: "2020",
              overview: "",
              posterPath: null,
            },
          ],
        }),
        new Date(frozen + RECOMMENDATION_STALE_RETENTION_MS).toISOString(),
        new Date(frozen).toISOString(),
      );
      clearTmdbSessionCache();
      const legacy = await new RecommendationServiceImpl(store).getTrending();
      expect(legacy.items[0]?.title).toBe("Legacy");
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a rejected genre lookup is returned but not cached for 24 hours", async () => {
    const originalFetch = globalThis.fetch;
    setSystemTime(new Date(frozen));
    const store = repository();
    const service = new RecommendationServiceImpl(store);
    const seed = [
      {
        title: "Arrival",
        type: "movie" as const,
        titleId: "1",
        watchedAt: "2026-11-20T00:00:00.000Z",
      },
      {
        title: "Dune",
        type: "movie" as const,
        titleId: "2",
        watchedAt: "2026-11-19T00:00:00.000Z",
      },
    ];
    globalThis.fetch = createFetchDouble(async (request) => {
      const url = String(request);
      if (url.includes("/movie/1")) return Response.json({ genres: [{ id: 18 }] });
      if (url.includes("/movie/2")) {
        return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/discover/tv")) return Response.json({ results: [] });
      if (url.includes("/discover/movie")) {
        return Response.json({ results: [titled("Interstellar", 3)] });
      }
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    });
    try {
      const section = await service.getPersonalizedByHistory(seed);
      expect(section.items.map((item) => item.title)).toEqual(["Interstellar"]);
      expect(
        store.get(buildRecommendCacheKey("movie:1|movie:2", "genre-affinity")),
      ).toBeUndefined();
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
