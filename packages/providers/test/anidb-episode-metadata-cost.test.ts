import { describe, expect, test } from "bun:test";

import type { ProviderRuntimeContext } from "@kunai/types";

import { anidbProviderModule, clearAnidbCachesForTest } from "../src/anidb/direct";
import { clearAnimeMetadataCacheForTest } from "../src/shared/anime-metadata";

// What this file protects: AniDB's own metadata is one request for a whole
// series, while Jikan pages 100 episodes at a time under a rate limit. Paying
// for Jikan when every title is already known is pure latency in front of the
// episode picker, and it is invisible in a correctness-only test — both passes
// produce the same titles.

const ANIDB_PAGE =
  '<a href="https://myanimelist.net/anime/5678/Plain-Show">MAL</a>' +
  '<a href="https://anilist.co/anime/1234">AniList</a>' +
  '<a href="https://anidb.net/anime/9876">AniDB</a>' +
  '<meta property="og:image" content="https://img.example/poster.jpg">';

const OFFICIAL_XML = `<?xml version="1.0"?>
  <anime id="9876">
    <episode id="1"><epno type="1">1</epno><airdate>2020-01-02</airdate>
      <title xml:lang="en">The Beginning</title></episode>
    <episode id="2"><epno type="1">2</epno><airdate>2020-01-09</airdate>
      <title xml:lang="en">The Journey</title></episode>
  </anime>`;

const OFFICIAL_ERROR = "<error code='500'>Client Values Missing or Invalid</error>";

const listInput = {
  title: { id: "plain-show-700", kind: "anime" as const, title: "Plain Show" },
  preferredAudioLanguage: "ja",
};
const listContext = { now: () => new Date().toISOString() } as ProviderRuntimeContext;

function stubAnidbFetch(officialBody: string): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/api/frontend/anime/700/episodes")) {
      return new Response(
        JSON.stringify({
          episodes: [
            { id: 70001, number: 1 },
            { id: 70002, number: 2 },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.includes("/anime/plain-show-700")) return new Response(ANIDB_PAGE, { status: 200 });
    if (url.includes("api.anidb.net:9001")) return new Response(officialBody, { status: 200 });
    if (url.includes("graphql.anilist.co")) {
      return new Response(
        JSON.stringify({
          data: {
            Media: {
              streamingEpisodes: [
                { title: "The Beginning", thumbnail: "https://img.example/ep-1.jpg" },
                { title: "The Journey", thumbnail: "https://img.example/ep-2.jpg" },
              ],
            },
          },
        }),
        { status: 200 },
      );
    }
    if (url.includes("api.jikan.moe")) {
      return new Response(
        JSON.stringify({
          data: [
            { mal_id: 1, title: "The Beginning", aired: "2020-01-02T00:00:00+00:00", filler: true },
          ],
          pagination: { has_next_page: false },
        }),
        { status: 200 },
      );
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return calls;
}

async function withStubbedRuntime<T>(
  officialBody: string,
  run: (calls: string[]) => Promise<T>,
): Promise<T> {
  const originalWhich = Bun.which;
  const originalFetch = globalThis.fetch;
  clearAnidbCachesForTest();
  clearAnimeMetadataCacheForTest();
  // Force the fetch path; the production path shells out to curl-impersonate.
  Bun.which = ((_command: string) => null) as typeof Bun.which;
  const calls = stubAnidbFetch(officialBody);
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
    Bun.which = originalWhich;
    clearAnidbCachesForTest();
    clearAnimeMetadataCacheForTest();
  }
}

const countCalls = (calls: readonly string[], host: string) =>
  calls.filter((url) => url.includes(host)).length;

describe("anidb episode metadata cost", () => {
  test("skips the paginated Jikan pass when official AniDB already titles every episode", async () => {
    await withStubbedRuntime(OFFICIAL_XML, async (calls) => {
      const episodes = await anidbProviderModule.listEpisodes?.(listInput, listContext);

      expect(episodes?.map((episode) => episode.name)).toEqual(["The Beginning", "The Journey"]);
      expect(countCalls(calls, "api.jikan.moe")).toBe(0);
      // AniList still runs: one request, and the only source of episode stills.
      expect(countCalls(calls, "graphql.anilist.co")).toBe(1);
      expect(episodes?.[0]?.artwork?.thumbnailUrl).toBe("https://img.example/ep-1.jpg");
    });
  });

  test("falls back to the full external pass when official metadata is unavailable", async () => {
    await withStubbedRuntime(OFFICIAL_ERROR, async (calls) => {
      const episodes = await anidbProviderModule.listEpisodes?.(listInput, listContext);
      expect(countCalls(calls, "api.jikan.moe")).toBe(1);
      // Filler is a Jikan-only signal, so its presence proves the pass ran and
      // its answer reached the option, not just that a request was made.
      expect(episodes?.[0]?.label).toContain("Filler");
    });
  });

  test("an error answer is never cached as 'this show has no episode metadata'", async () => {
    await withStubbedRuntime(OFFICIAL_ERROR, async (calls) => {
      await anidbProviderModule.listEpisodes?.(listInput, listContext);
      expect(countCalls(calls, "api.anidb.net:9001")).toBe(1);

      // Only the shared external cache is dropped; the official-metadata cache
      // must not be holding an empty answer from the failed read.
      clearAnimeMetadataCacheForTest();
      await anidbProviderModule.listEpisodes?.(listInput, listContext);
      expect(countCalls(calls, "api.anidb.net:9001")).toBe(2);
    });
  });

  test("a second listing reuses seeded official metadata instead of refetching it", async () => {
    await withStubbedRuntime(OFFICIAL_XML, async (calls) => {
      await anidbProviderModule.listEpisodes?.(listInput, listContext);
      const episodes = await anidbProviderModule.listEpisodes?.(listInput, listContext);
      expect(countCalls(calls, "api.anidb.net:9001")).toBe(1);
      expect(episodes?.[0]?.name).toBe("The Beginning");
    });
  });
});
