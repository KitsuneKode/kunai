import { afterEach, describe, expect, test } from "bun:test";

import {
  clearTmdbSessionCache,
  fetchTmdbJsonCached,
  formatTmdbSearchError,
  isTmdbNetworkError,
  LEGACY_PUBLIC_TMDB_API_KEY,
  resolveTmdbApiKey,
  TmdbHttpError,
} from "@/services/catalog/tmdb-proxy";

import { bundledTmdbKeyDefine } from "../../../../scripts/build-shared";

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

  test("a superseded AbortError is not rewritten as unreachable", () => {
    const error = new DOMException("The operation was aborted.", "AbortError");
    expect(isTmdbNetworkError(error)).toBe(false);
    expect(formatTmdbSearchError(error).message).toBe("The operation was aborted.");
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

  test("half-open: with every host in its breaker window, one host is probed, not none", async () => {
    let up = false;
    const urls: string[] = [];
    globalThis.fetch = Object.assign(
      async (input: string | URL | Request) => {
        const url = String(input);
        urls.push(url);
        if (up) {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error("getaddrinfo ENOTFOUND");
      },
      { preconnect: originalFetch.preconnect },
    );

    // The network is down: every host fails once and enters its breaker.
    await expect(fetchTmdbJsonCached("/movie/1")).rejects.toThrow();
    expect(urls).toHaveLength(4);

    // The network is back. The old walker skipped every host and threw
    // without a request for five minutes; the probe recovers immediately.
    up = true;
    urls.length = 0;
    await expect(fetchTmdbJsonCached("/movie/2")).resolves.toEqual({ ok: true });
    expect(urls).toHaveLength(1);
  });

  test("half-open: concurrent distinct requests share one probe; a 4xx closes the breaker", async () => {
    let up = false;
    let requests = 0;
    globalThis.fetch = Object.assign(
      async (input: string | URL | Request) => {
        requests += 1;
        if (!up) throw new Error("getaddrinfo ENOTFOUND");
        await Promise.resolve();
        return String(input).includes("/missing")
          ? new Response("{}", { status: 404 })
          : new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
      { preconnect: originalFetch.preconnect },
    );
    await expect(fetchTmdbJsonCached("/movie/1")).rejects.toThrow();
    up = true;
    requests = 0;
    const settled = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) => fetchTmdbJsonCached(`/movie/${index + 100}`)),
    );
    expect(requests).toBe(1);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);

    // A 404 is proof the host is up: the breaker closes and the next request
    // goes straight through instead of waiting out the window.
    clearTmdbSessionCache();
    up = false;
    await expect(fetchTmdbJsonCached("/movie/2")).rejects.toThrow();
    up = true;
    await expect(fetchTmdbJsonCached("/missing")).rejects.toThrow("404");
    requests = 0;
    await expect(fetchTmdbJsonCached("/movie/3")).resolves.toEqual({ ok: true });
    expect(requests).toBe(1);
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

  test("cancelling a joined type-ahead does not abort a submitted search on the same path", async () => {
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

    const typeahead = new AbortController();
    const submitted = fetchTmdbJsonCached("/movie/42");
    const suggest = fetchTmdbJsonCached("/movie/42", typeahead.signal);
    typeahead.abort();

    await expect(suggest).rejects.toThrow();
    await expect(submitted).resolves.toEqual({ ok: true });
    expect(fetchCount).toBe(1);
  });
});

describe("TMDB API key resolution", () => {
  test("user key, then the build-time Kunai key, then the legacy key", () => {
    const original = process.env.KUNAI_BUNDLED_TMDB_API_KEY;
    try {
      delete process.env.KUNAI_BUNDLED_TMDB_API_KEY;
      expect(resolveTmdbApiKey({})).toEqual({ key: LEGACY_PUBLIC_TMDB_API_KEY, source: "legacy" });
      expect(resolveTmdbApiKey({ KUNAI_TMDB_API_KEY: "  " })).toEqual({
        key: LEGACY_PUBLIC_TMDB_API_KEY,
        source: "legacy",
      });

      process.env.KUNAI_BUNDLED_TMDB_API_KEY = "kunaikey1234567890";
      expect(resolveTmdbApiKey({})).toEqual({ key: "kunaikey1234567890", source: "kunai" });
      expect(resolveTmdbApiKey({ KUNAI_TMDB_API_KEY: "mine" })).toEqual({
        key: "mine",
        source: "user",
      });
    } finally {
      if (original === undefined) delete process.env.KUNAI_BUNDLED_TMDB_API_KEY;
      else process.env.KUNAI_BUNDLED_TMDB_API_KEY = original;
    }
  });

  test("the release define inlines only a well-formed build key", () => {
    expect(bundledTmdbKeyDefine(undefined)).toEqual({});
    expect(bundledTmdbKeyDefine("")).toEqual({});
    expect(bundledTmdbKeyDefine('abc"; process.exit(1); "')).toEqual({});
    expect(bundledTmdbKeyDefine("0123456789abcdef0123456789abcdef")).toEqual({
      "process.env.KUNAI_BUNDLED_TMDB_API_KEY": '"0123456789abcdef0123456789abcdef"',
    });
  });
});

describe("TMDB errors never carry credentials", () => {
  test("the message keeps status, host and path, never the api_key query", () => {
    const error = new TmdbHttpError(
      404,
      "https://api.themoviedb.org/3/movie/1?api_key=SECRET123&language=en",
    );
    expect(error.message).toBe("404 https://api.themoviedb.org/3/movie/1");
    expect(formatTmdbSearchError(error).message).not.toContain("SECRET123");
  });

  test("a 404 from a direct host reaches the caller without the key", async () => {
    const originalFetch = globalThis.fetch;
    const original = process.env.KUNAI_TMDB_API_KEY;
    process.env.KUNAI_TMDB_API_KEY = "USERSECRETKEY";
    globalThis.fetch = Object.assign(
      async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("api_key=")) return new Response("{}", { status: 404 });
        throw new Error("getaddrinfo ENOTFOUND proxy");
      },
      { preconnect: originalFetch.preconnect },
    );
    try {
      const caught = await fetchTmdbJsonCached("/movie/999999").then(
        () => null,
        (error: Error) => error,
      );
      expect(caught).toBeInstanceOf(Error);
      const message = caught?.message ?? "";
      expect(message).toContain("404");
      expect(message).not.toContain("USERSECRETKEY");
      expect(formatTmdbSearchError(caught).message).not.toContain("USERSECRETKEY");
    } finally {
      globalThis.fetch = originalFetch;
      if (original === undefined) delete process.env.KUNAI_TMDB_API_KEY;
      else process.env.KUNAI_TMDB_API_KEY = original;
      clearTmdbSessionCache();
    }
  });
});
