import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  clearTmdbSessionCache,
  fetchTmdbJsonCached,
  formatTmdbSearchError,
  isTmdbNetworkError,
} from "@/services/catalog/tmdb-proxy";

// Hostname comparison, not a substring check: `"api.themoviedb.org"` inside a
// URL is a substring match that `api.themoviedb.org.attacker.example` also
// satisfies, which is exactly what CodeQL flags here.
function isTmdbApiUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === "api.themoviedb.org";
  } catch {
    return false;
  }
}

function isTmdbAltUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === "api.tmdb.org";
  } catch {
    return false;
  }
}

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

  beforeEach(() => {
    // hostRetryAfter is module-level and shared across test files: an earlier
    // file that trips every host leaves this suite's first test with zero
    // eligible hosts ("no TMDB hosts available"). Clear before, not just after.
    clearTmdbSessionCache();
  });

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
    // Each mirror gets exactly one attempt, then the breaker sends later
    // calls straight to TMDB.
    const urls: string[] = [];
    globalThis.fetch = Object.assign(
      async (input: string | URL | Request) => {
        const url = String(input);
        urls.push(url);
        if (isTmdbApiUrl(url)) {
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

    // Two proxy mirrors, each paid exactly once.
    expect(urls.filter((url) => !isTmdbApiUrl(url))).toHaveLength(2);
  });

  test("falls through to the tmdb.org alias when all earlier hosts fail", async () => {
    const urls: string[] = [];
    globalThis.fetch = Object.assign(
      async (input: string | URL | Request) => {
        const url = String(input);
        urls.push(url);
        if (isTmdbAltUrl(url)) {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error("getaddrinfo ENOTFOUND");
      },
      { preconnect: originalFetch.preconnect },
    );

    await expect(fetchTmdbJsonCached("/movie/1")).resolves.toEqual({ ok: true });
    // both proxy mirrors + the canonical host dead → the alias answered.
    expect(urls).toHaveLength(4);
    expect(isTmdbAltUrl(urls[3]!)).toBe(true);

    // Breakers stick: the next call goes straight to the surviving host.
    urls.length = 0;
    await expect(fetchTmdbJsonCached("/tv/2")).resolves.toEqual({ ok: true });
    expect(urls).toHaveLength(1);
    expect(isTmdbAltUrl(urls[0]!)).toBe(true);
  });

  test("a 4xx is a definitive answer — no mirror hop, no breaker", async () => {
    const urls: string[] = [];
    globalThis.fetch = Object.assign(
      async (input: string | URL | Request) => {
        const url = String(input);
        urls.push(url);
        return new Response("{}", {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      },
      { preconnect: originalFetch.preconnect },
    );

    await expect(fetchTmdbJsonCached("/movie/1")).rejects.toThrow("404");
    // Same upstream data on every host — a 404 resolves identically
    // everywhere, so only the first host was asked.
    expect(urls).toHaveLength(1);
  });

  test("a 5xx is an availability failure and advances the chain", async () => {
    const urls: string[] = [];
    globalThis.fetch = Object.assign(
      async (input: string | URL | Request) => {
        const url = String(input);
        urls.push(url);
        if (isTmdbAltUrl(url)) {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("{}", { status: 503 });
      },
      { preconnect: originalFetch.preconnect },
    );

    await expect(fetchTmdbJsonCached("/movie/1")).resolves.toEqual({ ok: true });
    expect(urls).toHaveLength(4);
    expect(isTmdbAltUrl(urls[3]!)).toBe(true);
  });

  test("a caller abort does not trip the proxy breaker or fire a fallback request", async () => {
    const urls: string[] = [];
    globalThis.fetch = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
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
    expect(urls.some((url) => !isTmdbApiUrl(url))).toBe(true);
  });
});
