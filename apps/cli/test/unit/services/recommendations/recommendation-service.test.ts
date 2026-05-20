import { describe, expect, test } from "bun:test";

import type { SearchResult } from "@/domain/types";
import {
  buildRecommendCacheKey,
  isCacheExpired,
  RecommendationServiceImpl,
} from "@/services/recommendations/RecommendationServiceImpl";

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
      const service = new RecommendationServiceImpl(cache as never);
      const section = await service.getTrending();

      expect(section.items).toEqual([]);
      expect(cache.setCalls).toBe(1);
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
      const service = new RecommendationServiceImpl(cache as never);
      const section = await service.getForTitle("438631", "movie");

      expect(section.items).toEqual([staleItem]);
      expect(cache.setCalls).toBe(0);
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
