import { afterEach, describe, expect, test } from "bun:test";

import type { ProviderEpisodeListInput, ProviderRuntimeContext } from "@kunai/types";

import {
  chooseAnidbSearchMatch,
  clearAnidbCachesForTest,
  collectAnidbAvailableAudioModes,
  fetchAnidbEpisodeCatalog,
  parseAnidbSeasonEvidence,
  type AnidbSearchResult,
  anidbProviderModule,
} from "../src/anidb/direct";
import { urlHasHostname } from "./helpers/anidb-urls";

/**
 * anidb.app reindexes slugs, so a persisted `providerNativeIds.anidb` can
 * point at an id that 404s forever (Solo Leveling 19413 → 4883). Repairing
 * that needs to know the id is *gone* — which is not the same fact as the
 * episode list being empty, and the two used to arrive as the same `[]`.
 */
afterEach(() => {
  clearAnidbCachesForTest();
});

function contextReturning(
  handler: (url: string) => { status: number; body: string },
): ProviderRuntimeContext {
  return {
    fetch: {
      async fetch(url: string) {
        if (!urlHasHostname(url, "anidb.app")) throw new Error(`unexpected host: ${url}`);
        const { status, body } = handler(url);
        return new Response(body, { status });
      },
    },
  } as unknown as ProviderRuntimeContext;
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
  function countingContext(episodesStatus: number): {
    context: ProviderRuntimeContext;
    browseCalls: () => number;
  } {
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
  const input = {
    title: {
      id: "solo-leveling-19413",
      title: "Solo Leveling",
      externalIds: { providerNativeIds: { anidb: "solo-leveling-19413" } },
    },
  } as unknown as ProviderEpisodeListInput;

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
