import { afterEach, expect, test } from "bun:test";

import { loadDiscoveryList } from "@/app/discovery-lists";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
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
