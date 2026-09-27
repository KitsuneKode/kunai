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

  test("maps Bun unable-to-connect failures to a friendly search message", () => {
    const error = new Error("Unable to connect. Is the computer able to access the url?");
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

  test("skips the proxy after one failure instead of paying a dead request per call", async () => {
    // api.videasy.to has gone NXDOMAIN before — while it is dead every
    // proxied attempt is a stalled DNS/TCP miss in front of the real call.
    // The breaker sends the second call straight to TMDB.
    const urls: string[] = [];
    globalThis.fetch = Object.assign(
      async (input: unknown) => {
        const url = String(input);
        urls.push(url);
        if (url.startsWith("https://api.themoviedb.org")) {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error("getaddrinfo ENOTFOUND api.videasy.to");
      },
      { preconnect: originalFetch.preconnect },
    );

    await expect(fetchTmdbJsonCached("/movie/1")).resolves.toEqual({ ok: true });
    await expect(fetchTmdbJsonCached("/tv/2")).resolves.toEqual({ ok: true });

    expect(urls.filter((url) => !url.includes("api.themoviedb.org"))).toHaveLength(1);
  });

  test("a caller abort does not trip the proxy breaker or fire a fallback request", async () => {
    const urls: string[] = [];
    globalThis.fetch = Object.assign(
      async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        urls.push(url);
        if (init?.signal?.aborted === true) {
          throw new DOMException("The operation was aborted.", "AbortError");
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      { preconnect: originalFetch.preconnect },
    );

    const controller = new AbortController();
    controller.abort();
    await expect(fetchTmdbJsonCached("/movie/1", controller.signal)).rejects.toThrow();
    // The abort spent exactly one request — no direct fallback on a cancelled call.
    expect(urls).toHaveLength(1);

    // The next caller still earns the proxy attempt — aborts are not evidence
    // the proxy is down.
    await expect(fetchTmdbJsonCached("/tv/2")).resolves.toEqual({ ok: true });
    expect(urls.some((url) => !url.includes("api.themoviedb.org"))).toBe(true);
  });
});
