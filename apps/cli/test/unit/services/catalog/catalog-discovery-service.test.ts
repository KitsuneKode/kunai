import { expect, test } from "bun:test";

import { CatalogDiscoveryService } from "@/services/catalog/CatalogDiscoveryService";

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
