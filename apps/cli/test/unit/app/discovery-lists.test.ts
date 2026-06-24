import { afterEach, expect, test } from "bun:test";

import { clearDiscoveryListCache, loadDiscoveryList } from "@/app/discover/discovery-lists";

const realFetch = globalThis.fetch;
const realDateNow = Date.now;

afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realDateNow;
  clearDiscoveryListCache();
});

test("loadDiscoveryList maps anime trending from AniList", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        data: {
          Page: {
            media: [
              {
                id: 21,
                title: { english: "Frieren", romaji: "Sousou no Frieren", native: "Frieren" },
                coverImage: { extraLarge: "https://img.example/frieren.jpg" },
                description: "A mage looks back and moves forward.",
                episodes: 28,
                averageScore: 90,
                popularity: 5000,
                startDate: { year: 2023 },
                synonyms: [],
              },
            ],
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;

  const results = await loadDiscoveryList("anime");

  expect(results[0]).toMatchObject({
    id: "21",
    title: "Frieren",
    posterPath: "https://img.example/frieren.jpg",
    metadataSource: "AniList trending",
    posterSource: "AniList",
    rating: 9,
  });
});

test("loadDiscoveryList reuses cached discovery results for thirty minutes", async () => {
  let now = 1_000;
  let calls = 0;
  Date.now = () => now;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        results: [
          {
            id: calls,
            media_type: "movie",
            title: `Movie ${calls}`,
            release_date: "2026-01-01",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;

  expect((await loadDiscoveryList("series"))[0]?.title).toBe("Movie 1");
  now += 29 * 60 * 1000;
  expect((await loadDiscoveryList("series"))[0]?.title).toBe("Movie 1");
  now += 2 * 60 * 1000;
  expect((await loadDiscoveryList("series"))[0]?.title).toBe("Movie 2");
  expect(calls).toBe(2);
});
