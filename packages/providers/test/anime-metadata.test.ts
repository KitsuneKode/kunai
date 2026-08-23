import { afterEach, describe, expect, test } from "bun:test";

import {
  allMangaEpisodeMetadataCacheKey,
  clearAnimeMetadataCacheForTest,
  enrichEpisodeOptionsWithAnimeMetadata,
  episodeMetadataTitleCoverage,
  fetchAnimeEpisodeMetadataByNumber,
  formatAnimeEpisodeLabel,
  getSeededEpisodeMetadata,
  mergeMiruroPipeEpisodeMetadata,
  parseAllMangaEpisodeNumber,
  pipeEpisodeMetadataTitleCoverage,
  seedEpisodeMetadataFromProvider,
  shouldSkipExternalEpisodeMetadataEnrichment,
  type AnimeEpisodeMetadata,
} from "../src/shared/anime-metadata";

afterEach(() => {
  clearAnimeMetadataCacheForTest();
});

describe("anime metadata helpers", () => {
  test("formatAnimeEpisodeLabel adds filler badge", () => {
    expect(formatAnimeEpisodeLabel(1, "Ryomen Sukuna", { filler: true })).toBe(
      "Episode 1 · Ryomen Sukuna · Filler",
    );
  });

  test("parseAllMangaEpisodeNumber reads detail episode string", () => {
    expect(
      parseAllMangaEpisodeNumber({
        index: 1,
        label: "Episode 12",
        detail: "12",
      }),
    ).toBe(12);
  });

  test("mergeMiruroPipeEpisodeMetadata captures stills and enrich prefers longer titles", () => {
    const metadata = new Map<number, import("../src/shared/anime-metadata").AnimeEpisodeMetadata>();
    mergeMiruroPipeEpisodeMetadata(metadata, [
      {
        number: 1,
        title: "I'm Luffy!",
        description: "Short synopsis",
        image: "https://image.tmdb.org/t/p/original/still.jpg",
      },
    ]);
    mergeMiruroPipeEpisodeMetadata(metadata, []);
    metadata.set(1, {
      number: 1,
      title: "I'm Luffy! The Man Who Will Become the Pirate King!",
      thumbnail: metadata.get(1)?.thumbnail,
      synopsis: metadata.get(1)?.synopsis,
      source: "merged",
    });

    const enriched = enrichEpisodeOptionsWithAnimeMetadata(
      [{ index: 1, label: "Episode 1" }],
      metadata,
      (episode) => episode.index,
    );
    expect(enriched[0]?.name).toBe("I'm Luffy! The Man Who Will Become the Pirate King!");
    expect(enriched[0]?.artwork?.thumbnailUrl).toBe(
      "https://image.tmdb.org/t/p/original/still.jpg",
    );
    expect(metadata.get(1)?.thumbnail).toBe("https://image.tmdb.org/t/p/original/still.jpg");
  });

  test("seedEpisodeMetadataFromProvider round-trips through getSeededEpisodeMetadata", () => {
    const key = allMangaEpisodeMetadataCacheKey("show-abc", "sub");
    seedEpisodeMetadataFromProvider(key, [
      { number: 1, title: "The Beginning", source: "allmanga" },
      { number: 2, title: "Next Step", source: "allmanga" },
    ]);

    const seeded = getSeededEpisodeMetadata(key);
    expect(seeded?.get(1)?.title).toBe("The Beginning");
    expect(seeded?.get(2)?.title).toBe("Next Step");
  });

  test("shouldSkipExternalEpisodeMetadataEnrichment gates at 80% titled episodes", () => {
    const metadata = new Map<number, AnimeEpisodeMetadata>();
    for (let number = 1; number <= 10; number += 1) {
      metadata.set(number, {
        number,
        title: number <= 8 ? `Episode ${number} title` : undefined,
        source: "miruro",
      });
    }

    expect(episodeMetadataTitleCoverage(metadata, 10)).toBe(0.8);
    expect(shouldSkipExternalEpisodeMetadataEnrichment(metadata, 10)).toBe(true);
    expect(shouldSkipExternalEpisodeMetadataEnrichment(metadata, 11)).toBe(false);
  });

  test("pipeEpisodeMetadataTitleCoverage measures pipe entry title density", () => {
    expect(
      pipeEpisodeMetadataTitleCoverage([
        { number: 1, title: "Pilot" },
        { number: 2, title: "Departure" },
        { number: 3 },
      ]),
    ).toBeCloseTo(2 / 3);
  });
});

/**
 * A failed page must not be cached as a complete catalog.
 *
 * `fetchJson` returns null for a non-OK response *or* a thrown request, so a
 * transient 429 mid-pagination used to fall through to `rows = []`, set
 * `hasNext` false, and return the pages gathered so far as though pagination
 * had finished. The caller then wrote that under the full-pass key with a
 * **30-day** TTL, freezing incomplete titles, air dates and filler flags for a
 * month.
 */
describe("episode metadata pagination completeness", () => {
  const MAL_ID = "5678";

  function jikanPage(episodes: readonly number[], hasNext: boolean): Response {
    return new Response(
      JSON.stringify({
        data: episodes.map((n) => ({ mal_id: n, title: `Episode ${n}`, filler: false })),
        pagination: { has_next_page: hasNext },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  test("a page failure is not remembered as a finished catalog", async () => {
    const originalFetch = globalThis.fetch;
    let jikanCalls = 0;
    try {
      globalThis.fetch = (async (input: string | URL | Request) => {
        const url = String(input instanceof Request ? input.url : input);
        if (!url.includes("jikan")) {
          return new Response(JSON.stringify({ data: { Media: { streamingEpisodes: [] } } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        jikanCalls += 1;
        // Page 1 succeeds and promises more; page 2 is rate limited.
        if (url.includes("page=1")) return jikanPage([1, 2], true);
        return new Response("rate limited", { status: 429 });
      }) as unknown as typeof fetch;

      const first = await fetchAnimeEpisodeMetadataByNumber({ malId: MAL_ID });
      // The partial data is still useful for this call.
      expect(first.get(1)?.title).toBe("Episode 1");
      expect(first.get(3)).toBeUndefined();
      const callsAfterFirst = jikanCalls;

      // The registry recovers. A second call must go back to the network
      // rather than serving the truncated catalog from a 30-day cache.
      globalThis.fetch = (async (input: string | URL | Request) => {
        const url = String(input instanceof Request ? input.url : input);
        if (!url.includes("jikan")) {
          return new Response(JSON.stringify({ data: { Media: { streamingEpisodes: [] } } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        jikanCalls += 1;
        if (url.includes("page=1")) return jikanPage([1, 2], true);
        return jikanPage([3, 4], false);
      }) as unknown as typeof fetch;

      const second = await fetchAnimeEpisodeMetadataByNumber({ malId: MAL_ID });
      expect(jikanCalls).toBeGreaterThan(callsAfterFirst);
      expect(second.get(3)?.title).toBe("Episode 3");
      expect(second.get(4)?.title).toBe("Episode 4");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a catalog that really did finish is cached and not refetched", async () => {
    const originalFetch = globalThis.fetch;
    let jikanCalls = 0;
    try {
      globalThis.fetch = (async (input: string | URL | Request) => {
        const url = String(input instanceof Request ? input.url : input);
        if (!url.includes("jikan")) {
          return new Response(JSON.stringify({ data: { Media: { streamingEpisodes: [] } } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        jikanCalls += 1;
        return jikanPage([1, 2], false);
      }) as unknown as typeof fetch;

      const first = await fetchAnimeEpisodeMetadataByNumber({ malId: "9999" });
      expect(first.get(2)?.title).toBe("Episode 2");
      const callsAfterFirst = jikanCalls;

      // Completeness still earns the cache — this fix must not disable it.
      const second = await fetchAnimeEpisodeMetadataByNumber({ malId: "9999" });
      expect(jikanCalls).toBe(callsAfterFirst);
      expect(second.get(2)?.title).toBe("Episode 2");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
