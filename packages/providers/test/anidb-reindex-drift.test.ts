import { afterEach, describe, expect, test } from "bun:test";

import type { ProviderRuntimeContext } from "@kunai/types";

import {
  chooseAnidbSearchMatch,
  clearAnidbCachesForTest,
  collectAnidbAvailableAudioModes,
  fetchAnidbEpisodeCatalog,
  parseAnidbSeasonEvidence,
  type AnidbSearchResult,
  anidbProviderModule,
} from "../src/anidb/direct";
import { __testing as curlImpersonateTesting } from "../src/shared/curl-impersonate";
import { urlHasHostname } from "./helpers/anidb-urls";
import { installGlobalRestore } from "./helpers/restore-globals";

/**
 * anidb.app reindexes slugs, so a persisted `providerNativeIds.anidb` can
 * point at an id that 404s forever (Solo Leveling 19413 → 4883). Repairing
 * that needs to know the id is *gone* — which is not the same fact as the
 * episode list being empty, and the two used to arrive as the same `[]`.
 */
afterEach(() => {
  clearAnidbCachesForTest();
});

// This file also rewrites PATH and `fetch`; a mid-test failure must not leak
// either one into the next file — and the PATH-keyed curl scan cache must be
// forgotten too, or the restore itself leaves a stale resolution.
installGlobalRestore();

function contextReturning(
  handler: (url: string) => { status: number; body: string },
): ProviderRuntimeContext {
  // SAFETY: `as never` — the stub supplies only the context fetch used under
  // test; never is assignable to the return type without a chain.
  return {
    fetch: {
      async fetch(url: string) {
        if (!urlHasHostname(url, "anidb.app")) throw new Error(`unexpected host: ${url}`);
        const { status, body } = handler(url);
        return new Response(body, { status });
      },
    },
  } as never;
}

describe("episode catalogue", () => {
  test("a 404 is reported as missing, not as an empty catalogue", async () => {
    const catalog = await fetchAnidbEpisodeCatalog(
      "solo-leveling-19413",
      undefined,
      contextReturning(() => ({ status: 404, body: "not found" })),
    );
    expect(catalog).toEqual({ episodes: [], missing: true });
  });

  test("a present but empty catalogue is not missing", async () => {
    // A season that exists with nothing listed yet. Conflating this with a
    // reindexed id is what sends the repair path off to search and hand back
    // a different show.
    const catalog = await fetchAnidbEpisodeCatalog(
      "some-new-season-5001",
      undefined,
      contextReturning(() => ({ status: 200, body: JSON.stringify({ episodes: [] }) })),
    );
    expect(catalog).toEqual({ episodes: [], missing: false });
  });

  test("a non-array episodes field is empty-but-present, not a crash", async () => {
    // `{"episodes":{}}` parses cleanly, so `?? []` never fires and the value
    // reaches `.flatMap`. That threw a TypeError out of the catalogue call —
    // malformed upstream data became a crash instead of an empty listing, and
    // an id that is probably fine would have looked broken.
    const catalog = await fetchAnidbEpisodeCatalog(
      "object-episodes-5003",
      undefined,
      contextReturning(() => ({ status: 200, body: JSON.stringify({ episodes: {} }) })),
    );
    expect(catalog).toEqual({ episodes: [], missing: false });
  });

  test("an unparseable body is not reported as missing", async () => {
    // The id may be perfectly good and the response mangled; claiming the id is
    // gone would re-search on no evidence.
    const catalog = await fetchAnidbEpisodeCatalog(
      "mangled-5002",
      undefined,
      contextReturning(() => ({ status: 200, body: "<html>nope" })),
    );
    expect(catalog.missing).toBe(false);
  });

  test("a cancelled caller is not retried through the curl fallback", async () => {
    // The fallback exists so a Cloudflare challenge gets a second chance with a
    // better TLS fingerprint. An abort is not a fingerprint problem: swallowing
    // it spent a whole curl request on work nobody was waiting for. The
    // internal 15s timeout still earns its retry, because this keys off the
    // caller's signal rather than the error shape.
    // Asserting "it rejects" would prove nothing: the fallback also rejects on
    // an aborted signal, so both behaviours look identical from outside. The
    // sentinel message only survives if the original error propagated instead
    // of curl being consulted and producing its own.
    const controller = new AbortController();
    controller.abort();
    let contextFetches = 0;
    // SAFETY: `as never` — the stub supplies only the context fetch used under
    // test.
    const context = {
      fetch: {
        async fetch() {
          contextFetches += 1;
          throw new Error("anidb-abort-sentinel");
        },
      },
    } as never;

    await expect(
      fetchAnidbEpisodeCatalog("cancelled-5004", controller.signal, context),
    ).rejects.toThrow("anidb-abort-sentinel");
    expect(contextFetches).toBe(1);
  });

  test("a real catalogue still parses and sorts", async () => {
    const catalog = await fetchAnidbEpisodeCatalog(
      "solo-leveling-4883",
      undefined,
      contextReturning(() => ({
        status: 200,
        body: JSON.stringify({
          episodes: [
            { id: 2, number: 2 },
            { id: 1, number: 1 },
          ],
        }),
      })),
    );
    expect(catalog.missing).toBe(false);
    expect(catalog.episodes.map((entry) => entry.number)).toEqual([1, 2]);
  });

  test("a missing id is answered from cache rather than re-requested per call site", async () => {
    // `resolveAnidbShow` and the episode-listing path both ask for the same id
    // on one resolve. Without a cached miss a dead id costs a 404 round trip
    // each time.
    let calls = 0;
    const context = contextReturning(() => {
      calls += 1;
      return { status: 404, body: "not found" };
    });
    await fetchAnidbEpisodeCatalog("gone-19413", undefined, context);
    await fetchAnidbEpisodeCatalog("gone-19413", undefined, context);
    expect(calls).toBe(1);
  });
});

describe("audio modes", () => {
  test("matches jpn/eng case-insensitively and ignores other languages", async () => {
    // Live anidb returns `eng,jpn,kor`. `languageEntryForMode` already lower-cased
    // before comparing; this collector did not, so the advertised modes could
    // disagree with what the resolver would actually find.
    const context = contextReturning(() => ({
      status: 200,
      body: JSON.stringify({
        languages: [
          { code: "JPN", embed_url: "https://anidb.app/e/1" },
          { code: "Eng", embed_url: "https://anidb.app/e/2" },
          { code: "kor", embed_url: "https://anidb.app/e/3" },
        ],
      }),
    }));
    expect(await collectAnidbAvailableAudioModes(16704, undefined, context)).toEqual([
      "sub",
      "dub",
    ]);
  });

  test("a kor-only episode advertises neither mode", async () => {
    const context = contextReturning(() => ({
      status: 200,
      body: JSON.stringify({ languages: [{ code: "kor", embed_url: "https://anidb.app/e/3" }] }),
    }));
    expect(await collectAnidbAvailableAudioModes(16705, undefined, context)).toEqual([]);
  });
});

function card(id: string, title: string, numericId: number): AnidbSearchResult {
  return { id, title, numericId, seasonEvidence: parseAnidbSeasonEvidence(title) };
}

describe("repair must not swap the show", () => {
  const results: readonly AnidbSearchResult[] = [
    card("unrelated-9001", "Some Other Anime", 9001),
    card("solo-leveling-4883", "Solo Leveling", 4883),
  ];

  test("a user search still gets the top card when nothing matches", () => {
    // Unchanged behaviour: a person who typed a query can see what they got.
    expect(chooseAnidbSearchMatch("totally different", results)?.id).toBe("unrelated-9001");
  });

  test("repairing a persisted id refuses a match with no title evidence", () => {
    // There is no reader here to notice the substitution, so a weak match must
    // not silently replace the show the user previously chose.
    expect(
      chooseAnidbSearchMatch("totally different", results, { requireTitleEvidence: true }),
    ).toBeNull();
  });

  test("repair still accepts a real title match", () => {
    expect(
      chooseAnidbSearchMatch("Solo Leveling", results, { requireTitleEvidence: true })?.id,
    ).toBe("solo-leveling-4883");
  });

  test("repair accepts a prefix match, which is how the reindexed season resolves", () => {
    const seasons: readonly AnidbSearchResult[] = [
      card(
        "solo-leveling-season-2-arise-from-the-shadow-4884",
        "Solo Leveling Season 2: Arise from the Shadow",
        4884,
      ),
    ];
    expect(
      chooseAnidbSearchMatch("Solo Leveling", seasons, { requireTitleEvidence: true })?.id,
    ).toBe("solo-leveling-season-2-arise-from-the-shadow-4884");
  });
});

/**
 * The wiring, not just the parts: `resolveAnidbShow` must re-search only when
 * the id is gone. `listEpisodes` is the cheapest entry point that runs it, and
 * a browse request is the observable side effect of a repair attempt.
 */
describe("repair triggers only on a missing id", () => {
  function countingContext(episodesStatus: number) {
    let browse = 0;
    const context = contextReturning((url) => {
      if (url.includes("/browse?q=")) {
        browse += 1;
        return { status: 200, body: "<html><body>no cards</body></html>" };
      }
      if (url.includes("/episodes")) {
        return episodesStatus === 404
          ? { status: 404, body: "not found" }
          : { status: 200, body: JSON.stringify({ episodes: [] }) };
      }
      return { status: 200, body: "{}" };
    });
    return { context, browseCalls: () => browse };
  }

  // Only the fields `resolveAnidbShow` reads; the rest of the contract is not
  // exercised by this path.
  // SAFETY: `as never` — the input stub carries only the fields
  // `resolveAnidbShow` reads, per the comment above.
  const input = {
    title: {
      id: "solo-leveling-19413",
      title: "Solo Leveling",
      externalIds: { providerNativeIds: { anidb: "solo-leveling-19413" } },
    },
  } as never;

  test("an empty catalogue does not trigger a search", async () => {
    // The regression this guards: a season with nothing listed yet is not a
    // stale id, and searching would trade a correct id for a browse ranking.
    const { context, browseCalls } = countingContext(200);
    await anidbProviderModule.listEpisodes?.(input, context);
    expect(browseCalls()).toBe(0);
  });

  test("a 404 catalogue does trigger a search", async () => {
    const { context, browseCalls } = countingContext(404);
    await anidbProviderModule.listEpisodes?.(input, context);
    expect(browseCalls()).toBeGreaterThan(0);
  });
});

describe("browse outages stay a transport failure", () => {
  // `searchAnidb` reports HTTP status now, so a Cloudflare/503 browse page
  // rejects instead of returning an empty card list. `listEpisodes` must map
  // that rejection to `null` (unreachable provider), not let it reject or
  // read it as "title has no episodes".
  // SAFETY: `as never` — same partial-input stub shape as above.
  const input = {
    title: { id: "x", title: "Solo Leveling" },
  } as never;

  // A non-OK non-404 `context.fetch` response falls through to anidbFetchText's
  // curl/plain-fetch fallback, which would otherwise hit the real anidb.app.
  // Strip PATH so no curl resolves (the wrapper scan is memoized, so reset it)
  // and stub global fetch for the no-curl leg.
  function stubFallbackTransports(
    fetchImpl: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>,
  ): () => void {
    const originalFetch = globalThis.fetch;
    const originalPath = process.env.PATH;
    process.env.PATH = "";
    curlImpersonateTesting.resetPathCache();
    // SAFETY: `as never` — the stub supplies only the fetch call shape used
    // under test; the global slot wants the full fetch surface.
    globalThis.fetch = fetchImpl as never;
    return () => {
      globalThis.fetch = originalFetch;
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      curlImpersonateTesting.resetPathCache();
    };
  }

  test("listEpisodes returns null when the browse request fails with HTTP status", async () => {
    const restore = stubFallbackTransports(() =>
      Promise.resolve(new Response("down", { status: 503 })),
    );
    try {
      const context = contextReturning((url) => {
        if (url.includes("/browse?q=")) return { status: 503, body: "Just a moment…" };
        return { status: 404, body: "not found" };
      });
      const episodes = await anidbProviderModule.listEpisodes?.(input, context);
      expect(episodes).toBeNull();
    } finally {
      restore();
    }
  });

  test("a cancelled caller still propagates instead of returning null", async () => {
    const restore = stubFallbackTransports(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          const fail = () => reject(new DOMException("aborted", "AbortError"));
          if (signal?.aborted) return fail();
          signal?.addEventListener("abort", fail);
        }),
    );
    try {
      const controller = new AbortController();
      const context = {
        ...contextReturning(() => ({ status: 503, body: "down" })),
        signal: controller.signal,
      };
      const pending = anidbProviderModule.listEpisodes?.(input, context);
      controller.abort();
      await expect(pending).rejects.toThrow();
    } finally {
      restore();
    }
  });
});
