import { afterEach, expect, test } from "bun:test";

import {
  CatalogDiscoveryService,
  DiscoveryUnavailableError,
  loadAnimeRecommendationsForMedia,
} from "@/services/catalog/CatalogDiscoveryService";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("CatalogDiscoveryService reuses cached trending results until ttl expires", async () => {
  let now = 1_000;
  let calls = 0;
  const service = new CatalogDiscoveryService(
    {
      anime: async () => [],
      tmdb: async () => {
        calls += 1;
        return [
          {
            id: String(calls),
            type: "movie",
            title: `Movie ${calls}`,
            year: "2026",
            overview: "",
            posterPath: null,
          },
        ];
      },
    },
    () => now,
  );

  expect((await service.loadTrending("series"))[0]?.title).toBe("Movie 1");
  now += 29 * 60 * 1000;
  expect((await service.loadTrending("series"))[0]?.title).toBe("Movie 1");
  now += 2 * 60 * 1000;
  expect((await service.loadTrending("series"))[0]?.title).toBe("Movie 2");
  expect(calls).toBe(2);
});

test("CatalogDiscoveryService dedupes in-flight trending loads per mode", async () => {
  let calls = 0;
  let releaseLoad!: () => void;
  const loadStarted = Promise.withResolvers<void>();
  const service = new CatalogDiscoveryService({
    anime: async () => [],
    tmdb: async () => {
      calls += 1;
      loadStarted.resolve();
      await new Promise<void>((resolve) => {
        releaseLoad = resolve;
      });
      return [
        { id: "1", type: "movie", title: "Shared", year: "2026", overview: "", posterPath: null },
      ];
    },
  });

  const first = service.loadTrending("series");
  await loadStarted.promise;
  const second = service.loadTrending("series");
  releaseLoad();

  expect(await first).toEqual(await second);
  expect(calls).toBe(1);
});

test("CatalogDiscoveryService keeps anime and series caches isolated", async () => {
  const service = new CatalogDiscoveryService({
    anime: async () => [
      { id: "anime", type: "series", title: "Anime", year: "2026", overview: "", posterPath: null },
    ],
    tmdb: async () => [
      { id: "tmdb", type: "movie", title: "Movie", year: "2026", overview: "", posterPath: null },
    ],
  });

  expect((await service.loadTrending("anime"))[0]?.id).toBe("anime");
  expect((await service.loadTrending("series"))[0]?.id).toBe("tmdb");
});

test("CatalogDiscoveryService never caches a failed trending load", async () => {
  let calls = 0;
  const service = new CatalogDiscoveryService({
    anime: async () => [],
    tmdb: async () => {
      calls += 1;
      if (calls === 1) throw new DiscoveryUnavailableError("TMDB trending", "request failed");
      return [
        { id: "1", type: "movie", title: "Movie", year: "2026", overview: "", posterPath: null },
      ];
    },
  });

  await expect(service.loadTrending("series")).rejects.toThrow(DiscoveryUnavailableError);
  // The failure must not have been cached: the very next call retries upstream.
  expect((await service.loadTrending("series"))[0]?.title).toBe("Movie");
  expect(calls).toBe(2);
});

test("CatalogDiscoveryService never caches an aborted trending load", async () => {
  let calls = 0;
  const controller = new AbortController();
  const service = new CatalogDiscoveryService({
    anime: async () => [],
    tmdb: async (signal) => {
      calls += 1;
      if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      return [
        { id: "1", type: "movie", title: "Movie", year: "2026", overview: "", posterPath: null },
      ];
    },
  });

  controller.abort();
  await expect(service.loadTrending("series", controller.signal)).rejects.toThrow("aborted");
  expect((await service.loadTrending("series"))[0]?.title).toBe("Movie");
  expect(calls).toBe(2);
});

test("CatalogDiscoveryService does not cache an empty trending result", async () => {
  let calls = 0;
  const service = new CatalogDiscoveryService({
    anime: async () => [],
    // Stands in for a loader that still folds a failure into `[]`.
    tmdb: async () => {
      calls += 1;
      return [];
    },
  });

  expect(await service.loadTrending("series")).toEqual([]);
  expect(await service.loadTrending("series")).toEqual([]);
  expect(calls).toBe(2);
});

test("CatalogDiscoveryService shares one failure across in-flight callers and retries after", async () => {
  let calls = 0;
  const firstLoad = Promise.withResolvers<never>();
  const loadStarted = Promise.withResolvers<void>();
  const service = new CatalogDiscoveryService({
    anime: async () => [],
    tmdb: async () => {
      calls += 1;
      if (calls === 1) {
        loadStarted.resolve();
        return firstLoad.promise;
      }
      return [
        { id: "1", type: "movie", title: "Movie", year: "2026", overview: "", posterPath: null },
      ];
    },
  });

  const first = captureRejection(service.loadTrending("series"));
  await loadStarted.promise;
  const second = captureRejection(service.loadTrending("series"));
  // Both handlers are attached before the rejection lands: a rejection with no
  // handler yet is an unhandled rejection, not a test signal.
  firstLoad.reject(new DiscoveryUnavailableError("TMDB trending", "request failed"));

  expect(await first).toBeInstanceOf(DiscoveryUnavailableError);
  expect(await second).toBeInstanceOf(DiscoveryUnavailableError);
  expect(calls).toBe(1);

  expect((await service.loadTrending("series"))[0]?.title).toBe("Movie");
  expect(calls).toBe(2);
});

test("CatalogDiscoveryService never caches a failed surprise load", async () => {
  let calls = 0;
  const service = new CatalogDiscoveryService({
    anime: async () => [],
    tmdb: async () => [],
    tmdbSurprise: async () => {
      calls += 1;
      if (calls === 1) throw new DiscoveryUnavailableError("TMDB surprise", "request failed");
      return [
        { id: "1", type: "movie", title: "Spin", year: "2026", overview: "", posterPath: null },
      ];
    },
  });

  const options = { random: () => 0 };
  await expect(service.loadSurprise("series", undefined, options)).rejects.toThrow(
    DiscoveryUnavailableError,
  );
  expect((await service.loadSurprise("series", undefined, options))[0]?.title).toBe("Spin");
  expect(calls).toBe(2);
});

/** Settles to the rejection reason, with the handler attached up front. */
function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

test("loadAnimeRecommendationsForMedia maps the Media.recommendations edge", async () => {
  let seenBody = "";
  globalThis.fetch = Object.assign(
    async (_input: unknown, init?: RequestInit) => {
      seenBody = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          data: {
            Media: {
              recommendations: {
                nodes: [
                  {
                    mediaRecommendation: {
                      id: 99,
                      title: { romaji: "Frieren", english: "Frieren: Beyond Journey's End" },
                      coverImage: { extraLarge: "https://img/frieren.jpg", large: null },
                      description: "Elves outlive everyone.",
                      episodes: 28,
                      format: "TV",
                      duration: 24,
                      averageScore: 91,
                      popularity: 5000,
                      startDate: { year: 2023 },
                      synonyms: [],
                    },
                  },
                  { mediaRecommendation: null },
                ],
              },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
    { preconnect: originalFetch.preconnect },
  );

  const results = await loadAnimeRecommendationsForMedia("21");
  expect(seenBody).toContain("recommendations");
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({
    id: "99",
    title: "Frieren: Beyond Journey's End",
    isAnime: true,
    metadataSource: "AniList similar titles",
  });
});

test("loadAnimeRecommendationsForMedia refuses non-numeric ids without a request", async () => {
  let calls = 0;
  globalThis.fetch = Object.assign(
    async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    },
    { preconnect: originalFetch.preconnect },
  );

  expect(await loadAnimeRecommendationsForMedia("tmdb:550")).toEqual([]);
  expect(calls).toBe(0);
});

test("loadAnimeRecommendationsForMedia resolves empty when the title has no recs", async () => {
  globalThis.fetch = Object.assign(
    async () =>
      new Response(JSON.stringify({ data: { Media: { recommendations: { nodes: [] } } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    { preconnect: originalFetch.preconnect },
  );

  expect(await loadAnimeRecommendationsForMedia("99999999")).toEqual([]);
});
