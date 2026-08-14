import { afterEach, expect, test } from "bun:test";

import type { SearchResult } from "@/domain/types";
import { enrichAnimeSearchResultsWithAniList } from "@/services/search/anime-metadata";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("enrichAnimeSearchResultsWithAniList adds title aliases and poster metadata", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        data: {
          Page: {
            media: [
              {
                id: 1,
                title: {
                  english: "Demon Slayer",
                  romaji: "Kimetsu no Yaiba",
                  native: "Kimetsu no Yaiba",
                },
                coverImage: { extraLarge: "https://img.example/demon-large.jpg" },
                description: "A young swordsman fights demons.",
                episodes: 26,
                averageScore: 84,
                popularity: 1000,
                startDate: { year: 2019 },
                synonyms: ["Blade of Demon Destruction"],
              },
            ],
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;

  const result: SearchResult = {
    id: "provider-id",
    type: "series",
    title: "Kimetsu no Yaiba",
    year: "",
    overview: "",
    posterPath: null,
  };

  const enriched = await enrichAnimeSearchResultsWithAniList("demon slayer", [result]);

  expect(enriched[0]).toMatchObject({
    title: "Kimetsu no Yaiba",
    year: "2019",
    posterPath: "https://img.example/demon-large.jpg",
    posterSource: "AniList",
    metadataSource: "AniList",
    episodeCount: 26,
    rating: 8.4,
    popularity: 1000,
  });
  expect(enriched[0]?.titleAliases?.map((alias) => alias.kind)).toContain("english");
});

test("enrichAnimeSearchResultsWithAniList upgrades MOVIE format to film structure", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        data: {
          Page: {
            media: [
              {
                id: 181053,
                title: {
                  english: "Demon Slayer: Kimetsu no Yaiba Infinity Castle",
                  romaji: "Kimetsu no Yaiba: Mugen Jou-hen",
                },
                description: "<i>Part 1</i><br><br>Tanjiro Kamado",
                format: "MOVIE",
                episodes: 1,
                duration: 155,
                startDate: { year: 2025 },
              },
            ],
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;

  const result: SearchResult = {
    id: "provider-id",
    type: "series",
    title: "Demon Slayer: Kimetsu no Yaiba Infinity Castle",
    year: "",
    overview: "",
    posterPath: null,
    episodeCount: 2,
  };

  const enriched = await enrichAnimeSearchResultsWithAniList("infinity castle", [result]);
  expect(enriched[0]?.type).toBe("movie");
  expect(enriched[0]?.episodeCount).toBeUndefined();
  expect(enriched[0]?.durationSeconds).toBe(9300);
  expect(enriched[0]?.overview).toBe("Part 1 Tanjiro Kamado");
});
