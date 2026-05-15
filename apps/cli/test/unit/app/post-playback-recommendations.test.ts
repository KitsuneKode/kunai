import { expect, test } from "bun:test";

import { loadPostPlaybackRecommendationNames } from "@/app/post-playback-recommendations";

test("post-playback recommendations use direct TMDB title recommendations for series ids", async () => {
  let directCalls = 0;
  let discoverCalls = 0;
  const names = await loadPostPlaybackRecommendationNames(
    {
      recommendationService: {
        getForTitle: async () => {
          directCalls += 1;
          return {
            label: "",
            reason: "similar",
            items: [
              {
                id: "2",
                type: "series",
                title: "Better Call Saul",
                year: "2015",
                overview: "",
                posterPath: null,
              },
            ],
          };
        },
        getGenreAffinity: async () => {
          discoverCalls += 1;
          return { label: "", reason: "genre-affinity", items: [] };
        },
        getPersonalizedByHistory: async () => {
          discoverCalls += 1;
          return { label: "", reason: "genre-affinity", items: [] };
        },
        getTrending: async () => {
          discoverCalls += 1;
          return { label: "", reason: "trending", items: [] };
        },
      },
      historyStore: { getAll: async () => ({}) },
      stateManager: { getState: () => ({ mode: "series" }) },
      providerRegistry: { getAll: () => [] },
    } as never,
    {
      id: "1396",
      type: "series",
      name: "Breaking Bad",
      year: "2008",
    },
    "series",
    null,
  );

  expect(names).toEqual(["Better Call Saul"]);
  expect(directCalls).toBe(1);
  expect(discoverCalls).toBe(0);
});

test("post-playback recommendations avoid provider-native anime ids and use discover sections", async () => {
  let directCalls = 0;
  const names = await loadPostPlaybackRecommendationNames(
    {
      recommendationService: {
        getForTitle: async () => {
          directCalls += 1;
          return { label: "", reason: "similar", items: [] };
        },
        getGenreAffinity: async () => ({
          label: "",
          reason: "genre-affinity",
          items: [
            {
              id: "21",
              type: "series",
              title: "The Ramparts of Ice",
              year: "2026",
              overview: "",
              posterPath: null,
            },
            {
              id: "22",
              type: "series",
              title: "Reborn as a Cat",
              year: "2026",
              overview: "",
              posterPath: null,
            },
          ],
        }),
        getPersonalizedByHistory: async () => ({
          label: "",
          reason: "genre-affinity",
          items: [
            {
              id: "23",
              type: "series",
              title: "Chibi Godzilla Raids Again",
              year: "2026",
              overview: "",
              posterPath: null,
            },
          ],
        }),
        getTrending: async () => ({ label: "", reason: "trending", items: [] }),
      },
      historyStore: {
        getAll: async () => ({
          "allanime:ramparts": {
            title: "The Ramparts of Ice",
            type: "series",
            season: 1,
            episode: 7,
            timestamp: 1200,
            duration: 1200,
            completed: true,
            provider: "allanime",
            watchedAt: "2026-05-15T10:00:00.000Z",
          },
        }),
      },
      stateManager: { getState: () => ({ mode: "anime" }) },
      providerRegistry: {
        getAll: () => [
          {
            metadata: {
              id: "allanime",
              isAnimeProvider: true,
            },
          },
        ],
      },
    } as never,
    {
      id: "allanime-ramparts",
      type: "series",
      name: "The Ramparts of Ice",
      year: "2026",
    },
    "anime",
    null,
  );

  expect(directCalls).toBe(0);
  expect(names).toEqual(["Reborn as a Cat", "Chibi Godzilla Raids Again"]);
});
