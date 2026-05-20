import { describe, expect, test } from "bun:test";

import { episodeInfoFromSelection } from "@/app/episode-info-from-catalog";

const originalFetch = globalThis.fetch;

describe("episodeInfoFromSelection", () => {
  test("uses anime catalog name when available", () => {
    const info = episodeInfoFromSelection({
      season: 1,
      episode: 2,
      isAnime: true,
      titleId: "anilist:21",
      animeEpisodes: [{ index: 2, label: "Episode 2 · Cherry", name: "Cherry" }],
    });
    expect(info.name).toBe("Cherry");
  });

  test("falls back to TMDB cache for series when warmed", async () => {
    const { fetchEpisodes, lookupCachedEpisode } = await import("@/tmdb");
    const fetchFixture = async () =>
      new Response(
        JSON.stringify({
          episodes: [
            {
              episode_number: 2,
              name: "Cherry",
              air_date: "2024-01-02",
              overview: "A deterministic fixture episode.",
            },
          ],
        }),
        { status: 200 },
      );
    globalThis.fetch = Object.assign(fetchFixture, {
      preconnect: originalFetch.preconnect,
    }) as typeof fetch;

    try {
      await fetchEpisodes("fixture-series", 1);
      expect(lookupCachedEpisode("fixture-series", 1, 2)?.name).toBe("Cherry");
    } finally {
      globalThis.fetch = originalFetch;
    }

    const info = episodeInfoFromSelection({
      season: 1,
      episode: 2,
      isAnime: false,
      titleId: "fixture-series",
    });
    expect(info.name).toBe("Cherry");
  });
});
