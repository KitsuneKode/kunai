import { expect, test } from "bun:test";

import { loadSurpriseList } from "@/app/discovery-lists";
import { SEARCH_BROWSE_COMMAND_IDS } from "@/app/SearchPhase";

test("search browse command palette exposes discover, random, and offline surfaces", () => {
  expect([...SEARCH_BROWSE_COMMAND_IDS].slice(0, 10)).toEqual([
    "filters",
    "recommendation",
    "random",
    "surprise",
    "calendar",
    "library",
    "downloads",
    "history",
    "download",
    "details",
  ]);
});

test("surprise discovery returns a shuffled catalog slice without relying on discover state", async () => {
  const results = await loadSurpriseList("anime", undefined, {
    random: () => 0,
    anime: async () => [
      {
        id: "1",
        type: "series",
        title: "Surprise Anime",
        year: "2026",
        overview: "",
        posterPath: null,
        metadataSource: "AniList surprise",
      },
    ],
    tmdb: async () => [],
  });

  expect(results).toEqual([
    expect.objectContaining({
      title: "Surprise Anime",
      metadataSource: "AniList surprise",
    }),
  ]);
});
