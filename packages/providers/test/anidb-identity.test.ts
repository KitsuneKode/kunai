import { describe, expect, test } from "bun:test";

import { fetchAnidbMalId, looksLikeAnidbShowId, resolveAnidbCurl } from "../src";

test("recognizes historical AniDB show ids, not bare or namespaced catalog ids", () => {
  expect(looksLikeAnidbShowId("demon-slayer-kimetsu-no-yaiba-21")).toBe(true);
  expect(looksLikeAnidbShowId("onigiri-0")).toBe(false);
  expect(looksLikeAnidbShowId("anilist:21")).toBe(false);
  expect(looksLikeAnidbShowId("3942")).toBe(false);
});

describe("fetchAnidbMalId", () => {
  test("extracts MAL id from anime page and caches result", async () => {
    const originalWhich = Bun.which;
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;

    try {
      // SAFETY: test stub — supplies only the surface this test exercises.
      Bun.which = ((_cmd: string) => null) as typeof Bun.which;
      // SAFETY: test stub — supplies only the surface this test exercises.
      globalThis.fetch = (async (url: string) => {
        fetchCalls++;
        if (String(url).includes("/anime/onigiri-3942")) {
          return new Response(
            '<html><body><a href="https://myanimelist.net/anime/32612/Onigiri">MAL</a></body></html>',
            { status: 200 },
          );
        }
        return new Response("Not found", { status: 404 });
      }) as never;

      const first = await fetchAnidbMalId("onigiri-3942");
      expect(first).toBe(32612);
      expect(fetchCalls).toBe(1);

      // Second call hits TTL cache
      const second = await fetchAnidbMalId("onigiri-3942");
      expect(second).toBe(32612);
      expect(fetchCalls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      Bun.which = originalWhich;
    }
  });

  test("returns undefined on missing or invalid MAL URL", async () => {
    const originalWhich = Bun.which;
    const originalFetch = globalThis.fetch;

    try {
      // SAFETY: test stub — supplies only the surface this test exercises.
      Bun.which = ((_cmd: string) => null) as typeof Bun.which;
      // SAFETY: test stub — supplies only the surface this test exercises.
      globalThis.fetch = (async () =>
        new Response("<html><body>No links here</body></html>", {
          status: 200,
        })) as never;

      expect(await fetchAnidbMalId("unknown-123")).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
      Bun.which = originalWhich;
    }
  });

  test("caches a genuine absence instead of re-scraping every resolve", async () => {
    // "No MAL link on the page" is an answer, not a miss. Representing it the
    // same way as a cache miss silently disables the cache for every show
    // without a MAL id, which is the population that gets scraped repeatedly.
    const originalWhich = Bun.which;
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;

    try {
      // SAFETY: test stub — supplies only the surface this test exercises.
      Bun.which = ((_cmd: string) => null) as typeof Bun.which;
      // SAFETY: test stub — supplies only the surface this test exercises.
      globalThis.fetch = (async () => {
        fetchCalls++;
        return new Response("<html><body>No links here</body></html>", { status: 200 });
      }) as never;

      expect(await fetchAnidbMalId("no-mal-1")).toBeUndefined();
      expect(await fetchAnidbMalId("no-mal-1")).toBeUndefined();
      expect(fetchCalls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      Bun.which = originalWhich;
    }
  });

  test("does not cache a transport failure, so a retry can still succeed", async () => {
    // A Cloudflare block or dropped connection says nothing about the show.
    // Caching it would suppress auto-skip for the full hour-long TTL.
    const originalWhich = Bun.which;
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;

    try {
      // SAFETY: test stub — supplies only the surface this test exercises.
      Bun.which = ((_cmd: string) => null) as typeof Bun.which;
      // SAFETY: test stub — supplies only the surface this test exercises.
      globalThis.fetch = (async () => {
        fetchCalls++;
        if (fetchCalls === 1) throw new Error("connection reset");
        return new Response(
          '<html><body><a href="https://myanimelist.net/anime/32612/Onigiri">MAL</a></body></html>',
          { status: 200 },
        );
      }) as never;

      expect(await fetchAnidbMalId("flaky-1")).toBeUndefined();
      expect(await fetchAnidbMalId("flaky-1")).toBe(32612);
      expect(fetchCalls).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
      Bun.which = originalWhich;
    }
  });
});

describe("anidb curl selection", () => {
  // Parity with ani-cli v5 `dep_ch_failover`. anidb.app is behind Cloudflare,
  // which fingerprints the TLS handshake, so a browser UA over curl's own
  // handshake still gets challenged -- and a challenge page answers as a MAL
  // miss, which silently disables AniSkip for a show that has one.
  /** A synthetic PATH: `names` are the only executables visible. */
  function onPath(names: readonly string[]) {
    const present = new Set(names);
    return {
      which: (cmd: string) => (present.has(cmd) ? `/usr/bin/${cmd}` : null),
      listPathEntries: () => names,
    };
  }

  test("prefers the newest curl-impersonate build over plain curl", () => {
    expect(resolveAnidbCurl(onPath(["curl", "curl_chrome116", "curl_chrome150"]))).toEqual({
      path: "/usr/bin/curl_chrome150",
      prefixArgs: [],
      impersonates: true,
      profile: "chrome150",
    });
  });

  // The bug this whole resolver was rewritten for. The old design hardcoded
  // ["curl_firefox135", "curl_chrome136", "curl_chrome116", "curl_ff117"], so a
  // machine carrying only builds newer than that list matched nothing and fell
  // through to plain curl -- silently losing Cloudflare bypass while capability
  // reporting still showed a green tick.
  test("discovers builds newer than any list could have been written against", () => {
    const future = ["curl", "curl_chrome199", "curl_firefox210"];
    expect(resolveAnidbCurl(onPath(future))).toEqual({
      path: "/usr/bin/curl_chrome199",
      prefixArgs: [],
      impersonates: true,
      profile: "chrome199",
    });
  });

  // Safari's 260 and Chrome's 150 are not on one scale, so family is the outer
  // ranking key and version only orders builds within a family.
  test("ranks family before version so a high Safari number cannot outrank Chrome", () => {
    expect(resolveAnidbCurl(onPath(["curl_safari260", "curl_chrome150"]))).toEqual({
      path: "/usr/bin/curl_chrome150",
      prefixArgs: [],
      impersonates: true,
      profile: "chrome150",
    });
  });

  test("orders a revision suffix above the bare version", () => {
    expect(resolveAnidbCurl(onPath(["curl_chrome133", "curl_chrome133a"]))).toEqual({
      path: "/usr/bin/curl_chrome133a",
      prefixArgs: [],
      impersonates: true,
      profile: "chrome133a",
    });
  });

  // A desktop CLI presenting a phone's handshake is a mismatch a fingerprinter
  // can notice, so mobile wrappers are skipped even when they are the newest.
  test("skips mobile builds in favour of an older desktop one", () => {
    expect(resolveAnidbCurl(onPath(["curl", "curl_chrome131_android", "curl_chrome116"]))).toEqual({
      path: "/usr/bin/curl_chrome116",
      prefixArgs: [],
      impersonates: true,
      profile: "chrome116",
    });
  });

  test("never selects a tor build", () => {
    expect(resolveAnidbCurl(onPath(["curl", "curl_tor145"]))).toEqual({
      path: "/usr/bin/curl",
      prefixArgs: [],
      impersonates: false,
      profile: null,
    });
  });

  test("marks plain curl as non-impersonating so cipher flags are applied", () => {
    expect(resolveAnidbCurl(onPath(["curl"]))).toEqual({
      path: "/usr/bin/curl",
      prefixArgs: [],
      impersonates: false,
      profile: null,
    });
  });

  test("falls back to plain curl when a discovered wrapper is not executable", () => {
    // Listed on PATH but `which` cannot resolve it -- a dangling symlink or a
    // non-executable file. Discovery must not strand the caller with nothing.
    expect(
      resolveAnidbCurl({
        which: (cmd: string) => (cmd === "curl" ? "/usr/bin/curl" : null),
        listPathEntries: () => ["curl", "curl_chrome150"],
      }),
    ).toEqual({ path: "/usr/bin/curl", prefixArgs: [], impersonates: false, profile: null });
  });

  test("reports no curl at all so the caller can fall back to fetch", () => {
    expect(resolveAnidbCurl(onPath([]))).toBeNull();
  });
});
