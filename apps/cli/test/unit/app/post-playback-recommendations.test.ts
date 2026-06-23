import { afterEach, expect, test } from "bun:test";

import { clearDiscoveryListCache } from "@/app/discovery-lists";
import {
  loadPostPlaybackRecommendationItems,
  loadPostPlaybackRecommendationNames,
  resolvePostPlaybackRecommendationLoadMode,
  seedPostPlaybackRecommendationItems,
} from "@/app/post-playback-recommendations";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearDiscoveryListCache();
});

test("load mode: skips when the seed already has items", () => {
  expect(
    resolvePostPlaybackRecommendationLoadMode({
      seedCount: 3,
      railEnabled: true,
      alreadyAttempted: false,
      autoContinueIntoRecommendationPossible: true,
    }),
  ).toBe("skip");
});

test("load mode: skips when the rail is disabled or already attempted", () => {
  const base = { seedCount: 0, autoContinueIntoRecommendationPossible: false } as const;
  expect(
    resolvePostPlaybackRecommendationLoadMode({
      ...base,
      railEnabled: false,
      alreadyAttempted: false,
    }),
  ).toBe("skip");
  expect(
    resolvePostPlaybackRecommendationLoadMode({
      ...base,
      railEnabled: true,
      alreadyAttempted: true,
    }),
  ).toBe("skip");
});

test("load mode: blocks only when auto-continue into a recommendation is possible", () => {
  expect(
    resolvePostPlaybackRecommendationLoadMode({
      seedCount: 0,
      railEnabled: true,
      alreadyAttempted: false,
      autoContinueIntoRecommendationPossible: true,
    }),
  ).toBe("block");
});

test("load mode: backgrounds the menu rail (never blocks first paint) otherwise", () => {
  // The common from-history case: empty seed, rail enabled, no auto-continue
  // (e.g. a next episode exists or autoplay-recommendations is off).
  expect(
    resolvePostPlaybackRecommendationLoadMode({
      seedCount: 0,
      railEnabled: true,
      alreadyAttempted: false,
      autoContinueIntoRecommendationPossible: false,
    }),
  ).toBe("background");
});

function mockAniListDiscovery(media: readonly Record<string, unknown>[]): void {
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("graphql.anilist.co")) {
        return new Response(JSON.stringify({ data: { Page: { media } } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(input);
    },
    { preconnect: originalFetch.preconnect },
  );
}

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
      historyRepository: { listLatestByTitle: () => [] },
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

test("post-playback recommendations avoid provider-native anime ids and use anime discovery", async () => {
  mockAniListDiscovery([
    {
      id: 22,
      title: { english: "Reborn as a Cat" },
      startDate: { year: 2026 },
      coverImage: { extraLarge: null, large: null },
      description: null,
      episodes: 12,
      averageScore: 75,
      popularity: 100,
      synonyms: [],
    },
    {
      id: 23,
      title: { english: "Chibi Godzilla Raids Again" },
      startDate: { year: 2026 },
      coverImage: { extraLarge: null, large: null },
      description: null,
      episodes: 12,
      averageScore: 75,
      popularity: 90,
      synonyms: [],
    },
  ]);

  let directCalls = 0;
  const names = await loadPostPlaybackRecommendationNames(
    {
      recommendationService: {
        getForTitle: async () => {
          directCalls += 1;
          return { label: "", reason: "similar", items: [] };
        },
        getGenreAffinity: async () => ({ label: "", reason: "genre-affinity", items: [] }),
        getPersonalizedByHistory: async () => ({ label: "", reason: "genre-affinity", items: [] }),
        getTrending: async () => ({ label: "", reason: "trending", items: [] }),
      },
      historyRepository: {
        listLatestByTitle: () => [
          {
            key: "k",
            titleId: "allanime:ramparts",
            title: "The Ramparts of Ice",
            mediaKind: "anime",
            season: 1,
            episode: 7,
            positionSeconds: 1200,
            durationSeconds: 1200,
            completed: true,
            providerId: "allanime",
            updatedAt: "2026-05-15T10:00:00.000Z",
            createdAt: "2026-05-15T10:00:00.000Z",
          },
        ],
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

test("post-playback recommendation items preserve playable identity for queue actions", async () => {
  let directCalls = 0;
  const items = await loadPostPlaybackRecommendationItems(
    {
      recommendationService: {
        getForTitle: async () => {
          directCalls += 1;
          return {
            label: "",
            reason: "similar",
            items: [
              {
                id: "1396",
                type: "series",
                title: "Breaking Bad",
                year: "2008",
                overview: "",
                posterPath: null,
              },
              {
                id: "2",
                type: "series",
                title: "Better Call Saul",
                year: "2015",
                overview: "A careful follow-up pick.",
                posterPath: "/poster.jpg",
              },
              {
                id: "2-duplicate",
                type: "series",
                title: " Better Call Saul ",
                year: "2015",
                overview: "",
                posterPath: null,
              },
            ],
          };
        },
        getGenreAffinity: async () => ({ label: "", reason: "genre-affinity", items: [] }),
        getPersonalizedByHistory: async () => ({ label: "", reason: "genre-affinity", items: [] }),
        getTrending: async () => ({ label: "", reason: "trending", items: [] }),
      },
      historyRepository: { listLatestByTitle: () => [] },
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

  expect(directCalls).toBe(1);
  expect(items).toEqual([
    {
      id: "2",
      type: "series",
      title: "Better Call Saul",
      year: "2015",
      overview: "A careful follow-up pick.",
      posterPath: "/poster.jpg",
    },
  ]);
});

test("post-playback recommendation seed is immediate and prefetched-only", () => {
  const items = seedPostPlaybackRecommendationItems({
    enabled: true,
    currentTitle: "Breaking Bad",
    prefetchedItems: [
      {
        id: "1396",
        type: "series",
        title: "Breaking Bad",
        year: "2008",
        overview: "",
        posterPath: null,
      },
      {
        id: "2",
        type: "series",
        title: "Better Call Saul",
        year: "2015",
        overview: "A careful follow-up pick.",
        posterPath: "/poster.jpg",
      },
      {
        id: "2-duplicate",
        type: "series",
        title: " Better Call Saul ",
        year: "2015",
        overview: "",
        posterPath: null,
      },
    ],
  });

  expect(items).toEqual([
    {
      id: "2",
      type: "series",
      title: "Better Call Saul",
      year: "2015",
      overview: "A careful follow-up pick.",
      posterPath: "/poster.jpg",
    },
  ]);
  expect(
    seedPostPlaybackRecommendationItems({
      enabled: false,
      currentTitle: "Breaking Bad",
      prefetchedItems: [
        {
          id: "2",
          type: "series",
          title: "Better Call Saul",
          year: "2015",
          overview: "",
          posterPath: null,
        },
      ],
    }),
  ).toEqual([]);
  expect(
    seedPostPlaybackRecommendationItems({
      enabled: true,
      currentTitle: "Breaking Bad",
      prefetchedItems: null,
    }),
  ).toEqual([]);
});
