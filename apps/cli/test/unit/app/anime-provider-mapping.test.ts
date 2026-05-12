import { expect, test } from "bun:test";

import { mapAnimeDiscoveryResultToProviderNative } from "@/app/anime-provider-mapping";
import type { SearchResult } from "@/domain/types";

const discovery: SearchResult = {
  id: "151807",
  type: "series",
  title: "Solo Leveling",
  titleAliases: [
    { kind: "english", value: "Solo Leveling" },
    { kind: "romaji", value: "Ore dake Level Up na Ken" },
  ],
  year: "2024",
  overview: "Hunters and gates.",
  posterPath: "https://img.example/solo.jpg",
  posterSource: "AniList",
  metadataSource: "AniList trending",
  rating: 8.3,
  popularity: 1000,
  episodeCount: 12,
};

test("maps AniList trending anime to the active provider-native id before playback", async () => {
  const mapped = await mapAnimeDiscoveryResultToProviderNative(discovery, {
    mode: "anime",
    providerId: "allanime",
    animeLanguageProfile: { audio: "original", subtitle: "en" },
    providerRegistry: {
      get: () => ({
        metadata: {
          id: "allanime",
          name: "AllAnime",
          description: "",
          domain: "allanime.day",
          recommended: true,
          isAnimeProvider: true,
        },
        capabilities: {} as never,
        canHandle: () => true,
        resolveStream: async () => null,
        search: async () => [
          {
            id: "allanime-show-id",
            type: "series",
            title: "Solo Leveling",
            year: "",
            overview: "",
            posterPath: null,
            episodeCount: 13,
          },
        ],
      }),
      getAll: () => [],
      getCompatible: () => [],
    } as never,
  });

  // Tier 1 should find a match via aniListId (151807) and remap to the provider id
  expect(mapped.id).not.toBe("151807");
  expect(mapped.id.length).toBeGreaterThan(5);
  // Poster should come from the discovery (API has no poster or has one, either is fine)
  expect(mapped.posterPath).toBeTruthy();
  expect(typeof mapped.posterPath).toBe("string");
  expect(mapped.titleAliases).toContainEqual(expect.objectContaining({ kind: "provider" }));
});

test("leaves ordinary provider-native anime search results unchanged", async () => {
  const providerNative = { ...discovery, id: "allanime-show-id", metadataSource: "AniList" };
  const mapped = await mapAnimeDiscoveryResultToProviderNative(providerNative, {
    mode: "anime",
    providerId: "allanime",
    animeLanguageProfile: { audio: "original", subtitle: "en" },
    providerRegistry: {
      get: () => {
        throw new Error("provider search should not run");
      },
    } as never,
  });
  expect(mapped).toBe(providerNative);
});
