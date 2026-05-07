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
  const queries: string[] = [];
  const mapped = await mapAnimeDiscoveryResultToProviderNative(discovery, {
    mode: "anime",
    providerId: "allanime",
    animeLang: "sub",
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
        search: async (query: string) => {
          queries.push(query);
          return [
            {
              id: "allanime-show-id",
              type: "series",
              title: "Solo Leveling",
              year: "",
              overview: "",
              posterPath: null,
              episodeCount: 13,
            },
          ];
        },
      }),
      getAll: () => [],
      getCompatible: () => [],
    } as never,
  });

  expect(queries[0]).toBe("Solo Leveling");
  expect(mapped.id).toBe("allanime-show-id");
  expect(mapped.posterPath).toBe("https://img.example/solo.jpg");
  expect(mapped.episodeCount).toBe(13);
  expect(mapped.titleAliases).toContainEqual({ kind: "provider", value: "Solo Leveling" });
});

test("leaves ordinary provider-native anime search results unchanged", async () => {
  const providerNative = { ...discovery, id: "allanime-show-id", metadataSource: "AniList" };
  const mapped = await mapAnimeDiscoveryResultToProviderNative(providerNative, {
    mode: "anime",
    providerId: "allanime",
    animeLang: "sub",
    providerRegistry: {
      get: () => {
        throw new Error("provider search should not run");
      },
    } as never,
  });

  expect(mapped).toBe(providerNative);
});
