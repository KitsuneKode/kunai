import { afterEach, describe, expect, test } from "bun:test";

import {
  clearTmdbSessionCache,
  fetchTmdbJsonCached,
  formatTmdbSearchError,
  isTmdbNetworkError,
} from "@/services/catalog/tmdb-proxy";

describe("tmdb proxy search errors", () => {
  test("maps socket failures to a friendly search message", () => {
    const error = new Error("Was there a typo in the url or port?");
    error.name = "FailedToOpenSocket";
    expect(isTmdbNetworkError(error)).toBe(true);
    expect(formatTmdbSearchError(error).message).toBe("Search service unreachable");
  });

  test("preserves non-network errors", () => {
    const error = new Error("Search failed: 500");
    expect(formatTmdbSearchError(error).message).toBe("Search failed: 500");
  });
});

describe("fetchTmdbJsonCached", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearTmdbSessionCache();
  });

  test("dedupes concurrent requests for the same path", async () => {
    let fetchCount = 0;
    globalThis.fetch = Object.assign(
      async () => {
        fetchCount += 1;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      { preconnect: originalFetch.preconnect },
    );

    const [first, second] = await Promise.all([
      fetchTmdbJsonCached("/movie/1"),
      fetchTmdbJsonCached("/movie/1"),
    ]);

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(fetchCount).toBe(1);
  });

  test("serves cached responses without refetching", async () => {
    let fetchCount = 0;
    globalThis.fetch = Object.assign(
      async () => {
        fetchCount += 1;
        return new Response(JSON.stringify({ count: fetchCount }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      { preconnect: originalFetch.preconnect },
    );

    const first = await fetchTmdbJsonCached("/tv/2");
    const second = await fetchTmdbJsonCached("/tv/2");

    expect(first).toEqual({ count: 1 });
    expect(second).toEqual({ count: 1 });
    expect(fetchCount).toBe(1);
  });
});
