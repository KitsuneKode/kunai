import { afterEach, describe, expect, test } from "bun:test";

import {
  clearTmdbSessionCache,
  fetchTmdbJsonCached,
  fetchTmdbJsonWithFallback,
  setTmdbUserKeySource,
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

  test("after a failed recovery probe, requests fail fast until the next probe window", async () => {
    let requests = 0;
    globalThis.fetch = Object.assign(
      async () => {
        requests += 1;
        throw new Error("connect ETIMEDOUT");
      },
      { preconnect: originalFetch.preconnect },
    );
    await expect(fetchTmdbJsonCached("/movie/1")).rejects.toThrow();
    // First half-open probe fails…
    requests = 0;
    await expect(fetchTmdbJsonCached("/movie/2")).rejects.toThrow();
    expect(requests).toBe(1);
    // …so the next requests in the window cost no network at all.
    requests = 0;
    await expect(fetchTmdbJsonCached("/movie/3")).rejects.toThrow("recovery probe pending");
    await expect(fetchTmdbJsonCached("/movie/4")).rejects.toThrow("recovery probe pending");
    expect(requests).toBe(0);
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
    // An already-cancelled call spends no request at all, and so no fallback either.
    expect(urls).toHaveLength(0);

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

describe("mirror host failures fall through to direct TMDB", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setTmdbUserKeySource(null);
    clearTmdbSessionCache();
  });

  function isDirectHost(url: string): boolean {
    return isTmdbApiUrl(url) || isTmdbAltUrl(url);
  }

  function install(
    respond: (url: string, init: RequestInit | undefined) => Response,
  ): { url: string; authorization: string | null }[] {
    const seen: { url: string; authorization: string | null }[] = [];
    globalThis.fetch = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        seen.push({ url, authorization: new Headers(init?.headers).get("authorization") });
        return respond(url, init);
      },
      { preconnect: originalFetch.preconnect },
    );
    return seen;
  }

  test("a mirror 401 opens that mirror's breaker, falls through to direct TMDB, and sends no credentials", async () => {
    const seen = install((url) =>
      isDirectHost(url)
        ? Response.json({ via: "direct" })
        : new Response("denied", { status: 401, headers: { "content-type": "text/plain" } }),
    );
    await expect(fetchTmdbJsonCached("/movie/401")).resolves.toEqual({ via: "direct" });
    const mirrors = seen.filter((request) => !isDirectHost(request.url));
    expect(mirrors.length).toBeGreaterThan(0);
    for (const request of mirrors) {
      expect(request.url).not.toContain("api_key=");
      expect(request.authorization).toBeNull();
    }
    expect(seen.some((request) => isTmdbApiUrl(request.url))).toBe(true);

    seen.length = 0;
    await expect(fetchTmdbJsonCached("/movie/401-next")).resolves.toEqual({ via: "direct" });
    expect(seen.every((request) => isDirectHost(request.url))).toBe(true);
  });

  test("a mirror 403 opens that mirror's breaker, falls through to direct TMDB, and sends no credentials", async () => {
    const seen = install((url) =>
      isDirectHost(url)
        ? Response.json({ via: "direct" })
        : new Response("<html>forbidden</html>", {
            status: 403,
            headers: { "content-type": "text/html" },
          }),
    );
    await expect(fetchTmdbJsonCached("/movie/403")).resolves.toEqual({ via: "direct" });
    for (const request of seen.filter((entry) => !isDirectHost(entry.url))) {
      expect(request.url).not.toContain("api_key=");
      expect(request.authorization).toBeNull();
    }
    expect(seen.some((request) => isDirectHost(request.url))).toBe(true);

    seen.length = 0;
    await expect(fetchTmdbJsonCached("/movie/403-next")).resolves.toEqual({ via: "direct" });
    expect(seen.every((request) => isDirectHost(request.url))).toBe(true);
  });

  test("a mirror HTML 404 falls through while a direct JSON 404 is definitive", async () => {
    const urls: string[] = [];
    globalThis.fetch = Object.assign(
      async (input: string | URL | Request) => {
        const url = String(input);
        urls.push(url);
        if (!isDirectHost(url)) {
          return new Response("<html>missing</html>", {
            status: 404,
            headers: { "content-type": "text/html" },
          });
        }
        if (isTmdbApiUrl(url)) {
          return new Response(JSON.stringify({ status_code: 34 }), {
            status: 404,
            headers: { "content-type": "application/json" },
          });
        }
        return Response.json({ via: "alt" });
      },
      { preconnect: originalFetch.preconnect },
    );

    await expect(fetchTmdbJsonCached("/movie/html-404")).rejects.toThrow("404");
    expect(urls.some((url) => !isDirectHost(url))).toBe(true);
    expect(urls.filter((url) => isTmdbApiUrl(url))).toHaveLength(1);
    expect(urls.filter((url) => isTmdbAltUrl(url))).toHaveLength(0);
  });

  test("a non-ok mirror body is cancelled before the walk moves on", async () => {
    let cancelled = 0;
    globalThis.fetch = Object.assign(
      async (input: string | URL | Request) => {
        const url = String(input);
        if (!isDirectHost(url)) {
          const body = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("<html>forbidden</html>"));
            },
            cancel() {
              cancelled += 1;
            },
          });
          return new Response(body, { status: 403, headers: { "content-type": "text/html" } });
        }
        return Response.json({ via: "direct" });
      },
      { preconnect: originalFetch.preconnect },
    );

    await expect(fetchTmdbJsonCached("/movie/cancel-body")).resolves.toEqual({ via: "direct" });
    expect(cancelled).toBeGreaterThan(0);
  });

  test("two hanging mirrors reach direct TMDB within the mirror budget", async () => {
    let clock = 0;
    let nextId = 1;
    const pending = new Map<number, { readonly callback: () => void; readonly ms: number }>();
    const timers = {
      setTimeout(callback: () => void, ms: number) {
        const id = nextId;
        nextId += 1;
        pending.set(id, { callback, ms });
        return id;
      },
      clearTimeout(id: number) {
        pending.delete(id);
      },
    };
    const urls: string[] = [];
    globalThis.fetch = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        urls.push(url);
        if (isDirectHost(url)) return Response.json({ via: "direct" });
        return new Promise<Response>((_resolve, reject) => {
          const abort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
          if (init?.signal?.aborted === true) {
            abort();
            return;
          }
          init?.signal?.addEventListener("abort", abort, { once: true });
        });
      },
      { preconnect: originalFetch.preconnect },
    );

    const result = fetchTmdbJsonWithFallback("/movie/hang", undefined, 6_000, undefined, {
      now: () => clock,
      timers,
      budget: { maxTotalMirrorWaitMs: 2_500, perMirrorTimeoutMs: 1_500 },
    });
    const flush = async () => {
      for (let step = 0; step < 8; step += 1) await Promise.resolve();
    };
    const fireNext = async () => {
      await flush();
      const next = pending.entries().next().value;
      if (!next) throw new Error("expected a scheduled mirror timeout");
      const [id, entry] = next;
      pending.delete(id);
      clock += entry.ms;
      entry.callback();
      await flush();
      return entry.ms;
    };

    await flush();
    expect(pending.size).toBe(1);
    expect([...pending.values()][0]?.ms).toBe(1_500);
    await fireNext();
    expect([...pending.values()][0]?.ms).toBe(1_000);
    await fireNext();
    await expect(result).resolves.toEqual({ via: "direct" });
    expect(clock).toBeLessThanOrEqual(2_500);
    expect(urls.some((url) => isDirectHost(url))).toBe(true);
    expect(pending.size).toBe(0);
  });

  test("a slow keyed direct failure does not spend the mirror budget", async () => {
    setTmdbUserKeySource(() => "0123456789abcdef0123456789abcdef");
    let clock = 0;
    const gate = Promise.withResolvers<void>();
    const seen: string[] = [];
    globalThis.fetch = Object.assign(
      async (input: string | URL | Request) => {
        const url = String(input);
        seen.push(url);
        if (url.startsWith("https://api.themoviedb.org/")) {
          await gate.promise;
          throw new Error("direct slow");
        }
        if (isDirectHost(url)) throw new Error("direct down");
        return Response.json({ via: "mirror" });
      },
      { preconnect: originalFetch.preconnect },
    );
    const timers = {
      setTimeout(_callback: () => void, _ms: number) {
        return 1;
      },
      clearTimeout(_id: number) {},
    };
    const pending = fetchTmdbJsonWithFallback("/movie/slow-direct", undefined, 6_000, undefined, {
      now: () => clock,
      timers,
      budget: { maxTotalMirrorWaitMs: 2_500, perMirrorTimeoutMs: 1_500 },
    });
    for (let step = 0; step < 8; step += 1) await Promise.resolve();
    clock = 3_000;
    gate.resolve();
    await expect(pending).resolves.toEqual({ via: "mirror" });
    expect(seen.some((url) => !isDirectHost(url))).toBe(true);
  });

  test("after a failed direct half-open probe, the next probe can use a mirror", async () => {
    let clock = 1_000_000;
    const seen: string[] = [];
    let phase: "trip" | "probe" = "trip";
    globalThis.fetch = Object.assign(
      async (input: string | URL | Request) => {
        const url = String(input);
        seen.push(url);
        if (phase === "trip") {
          clock += 1_000;
          throw new Error("down");
        }
        if (isDirectHost(url)) throw new Error("direct still down");
        return Response.json({ via: "mirror" });
      },
      { preconnect: originalFetch.preconnect },
    );
    const timers = {
      setTimeout(_callback: () => void, _ms: number) {
        return 1;
      },
      clearTimeout(_id: number) {},
    };
    const deps = {
      now: () => clock,
      timers,
      budget: { maxTotalMirrorWaitMs: 2_500, perMirrorTimeoutMs: 1_500 },
    };
    await expect(
      fetchTmdbJsonWithFallback("/movie/breakers", undefined, 6_000, undefined, deps),
    ).rejects.toThrow();

    setTmdbUserKeySource(() => "0123456789abcdef0123456789abcdef");
    phase = "probe";
    seen.length = 0;
    await expect(
      fetchTmdbJsonWithFallback("/movie/probe-direct", undefined, 6_000, undefined, deps),
    ).rejects.toThrow();
    expect(seen).toHaveLength(1);
    expect(isDirectHost(seen[0] ?? "")).toBe(true);

    clock += 30_000;
    seen.length = 0;
    await expect(
      fetchTmdbJsonWithFallback("/movie/probe-mirror", undefined, 6_000, undefined, deps),
    ).resolves.toEqual({ via: "mirror" });
    expect(seen).toHaveLength(1);
    expect(isDirectHost(seen[0] ?? "")).toBe(false);
  });

  test("half-open recovery prefers the direct host when a credential exists", async () => {
    let up = false;
    const urls: string[] = [];
    globalThis.fetch = Object.assign(
      async (input: string | URL | Request) => {
        const url = String(input);
        urls.push(url);
        if (!up) throw new Error("getaddrinfo ENOTFOUND");
        return Response.json({ ok: true });
      },
      { preconnect: originalFetch.preconnect },
    );

    await expect(fetchTmdbJsonCached("/movie/down")).rejects.toThrow();
    up = true;
    urls.length = 0;
    await expect(fetchTmdbJsonCached("/movie/probe")).resolves.toEqual({ ok: true });
    expect(urls).toHaveLength(1);
    expect(isDirectHost(urls[0] ?? "")).toBe(true);
  });
});

describe("TMDB API key resolution", () => {
  test("user key, then the build-time Kunai key, then the legacy key", () => {
    const original = process.env.KUNAI_BUNDLED_TMDB_API_KEY;
    try {
      delete process.env.KUNAI_BUNDLED_TMDB_API_KEY;
      if (LEGACY_PUBLIC_TMDB_API_KEY === null) {
        throw new Error("legacy TMDB key fixture retired; update this resolution test");
      }
      expect(resolveTmdbApiKey({})).toEqual({
        key: LEGACY_PUBLIC_TMDB_API_KEY,
        source: "legacy",
        kind: "api-key",
      });
      expect(resolveTmdbApiKey({ KUNAI_TMDB_API_KEY: "  " })).toMatchObject({
        key: LEGACY_PUBLIC_TMDB_API_KEY,
        source: "legacy",
      });

      process.env.KUNAI_BUNDLED_TMDB_API_KEY = "kunaikey1234567890";
      expect(resolveTmdbApiKey({})).toMatchObject({ key: "kunaikey1234567890", source: "kunai" });
      expect(resolveTmdbApiKey({ KUNAI_TMDB_API_KEY: "mine" })).toEqual({
        key: "mine",
        source: "user",
        kind: "api-key",
        origin: "env",
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
