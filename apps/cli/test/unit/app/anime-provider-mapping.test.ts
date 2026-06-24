import { expect, test } from "bun:test";

import { mapAnimeDiscoveryResultToProviderNative } from "@/app/discover/anime-provider-mapping";
import type { SearchResult } from "@/domain/types";
import { streamRequestToResolveInput } from "@/services/providers/stream-request-adapter";

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

const allanimeProviderRegistry = {
  get: () => ({
    metadata: {
      id: "allanime",
      name: "AllAnime",
      description: "",
      domain: "allanime.day",
      recommended: true,
      isAnimeProvider: true,
      catalogIdentity: "provider-native" as const,
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
} as never;

const miruroProviderRegistry = {
  get: () => ({
    metadata: {
      id: "miruro",
      name: "Miruro",
      description: "",
      domain: "miruro.to",
      recommended: true,
      isAnimeProvider: true,
      catalogIdentity: "anilist" as const,
    },
    capabilities: {} as never,
    canHandle: () => true,
    resolveStream: async () => null,
  }),
  getAll: () => [],
  getCompatible: () => [],
} as never;

test("maps AniList trending anime to the active provider-native id before playback", async () => {
  const mapped = await mapAnimeDiscoveryResultToProviderNative(discovery, {
    mode: "anime",
    providerId: "allanime",
    animeLanguageProfile: { audio: "original", subtitle: "en" },
    searchProviderNative: async () => [],
    providerRegistry: allanimeProviderRegistry,
  });

  // Tier 1 should find a match via aniListId (151807) and remap to the provider id
  expect(mapped.id).not.toBe("151807");
  expect(mapped.id.length).toBeGreaterThan(5);
  // Poster should come from the discovery (API has no poster or has one, either is fine)
  expect(mapped.posterPath).toBeTruthy();
  expect(typeof mapped.posterPath).toBe("string");
  expect(mapped.titleAliases).toContainEqual(expect.objectContaining({ kind: "provider" }));
});

test("preserves anilistId in externalIds when remapping to provider-native id", async () => {
  const mapped = await mapAnimeDiscoveryResultToProviderNative(discovery, {
    mode: "anime",
    providerId: "allanime",
    animeLanguageProfile: { audio: "original", subtitle: "en" },
    searchProviderNative: async () => [
      {
        id: "allanime-show-id",
        title: "Solo Leveling",
        type: "series",
        aniListId: 151807,
        malId: 151807,
      },
    ],
    providerRegistry: allanimeProviderRegistry,
  });

  expect(mapped.id).toBe("allanime-show-id");
  expect(mapped.externalIds?.anilistId).toBe("151807");
  expect(mapped.externalIds?.malId).toBe("151807");
});

test("keeps AniList id intact when active provider uses anilist catalog identity", async () => {
  const mapped = await mapAnimeDiscoveryResultToProviderNative(discovery, {
    mode: "anime",
    providerId: "miruro",
    animeLanguageProfile: { audio: "original", subtitle: "en" },
    searchProviderNative: async () => {
      throw new Error("AllManga search should not run for Miruro");
    },
    providerRegistry: miruroProviderRegistry,
  });

  expect(mapped.id).toBe("151807");
  expect(mapped.externalIds?.anilistId).toBe("151807");
});

test("miruro mapping chain preserves numeric anilistId for resolve (Farming Life S2)", async () => {
  const farmingLife: SearchResult = {
    ...discovery,
    id: "197824",
    title: "Farming Life in Another World Season 2",
    metadataSource: "AniList search",
    externalIds: { anilistId: "197824" },
  };

  const mapped = await mapAnimeDiscoveryResultToProviderNative(farmingLife, {
    mode: "anime",
    providerId: "miruro",
    animeLanguageProfile: { audio: "original", subtitle: "en" },
    providerRegistry: miruroProviderRegistry,
  });

  expect(mapped.id).toBe("197824");

  const resolveInput = streamRequestToResolveInput(
    {
      title: {
        id: mapped.id,
        type: "series",
        name: mapped.title,
        externalIds: mapped.externalIds,
      },
      episode: { season: 1, episode: 1 },
      audioPreference: "original",
      subtitlePreference: "en",
    },
    "anime",
    "play",
    "anilist",
  );

  expect(resolveInput.title.anilistId).toBe("197824");
  expect(resolveInput.title.id).toBe("197824");
});

test("remaps history titles with anilist externalIds for provider-native providers", async () => {
  const historyBacked = {
    ...discovery,
    id: "20431",
    title: "Hozuki's Coolheadedness",
    metadataSource: "AniList history",
    externalIds: { anilistId: "20431" },
  };

  const mapped = await mapAnimeDiscoveryResultToProviderNative(historyBacked, {
    mode: "anime",
    providerId: "allanime",
    animeLanguageProfile: { audio: "original", subtitle: "en" },
    searchProviderNative: async () => [
      {
        id: "bxCKTnota29uSRnZw",
        title: "Hoozuki no Reitetsu",
        type: "series",
        aniListId: 20431,
      },
    ],
    providerRegistry: allanimeProviderRegistry,
  });

  expect(mapped.id).toBe("bxCKTnota29uSRnZw");
  expect(mapped.externalIds?.anilistId).toBe("20431");
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
