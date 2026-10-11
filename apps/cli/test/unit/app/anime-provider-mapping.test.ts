import { beforeEach, expect, test } from "bun:test";

import {
  __testing as animeMappingTesting,
  mapAnimeDiscoveryResultToProviderNative,
} from "@/app/discover/anime-provider-mapping";
import type { SearchResult } from "@/domain/types";
import { streamRequestToResolveInput } from "@/services/providers/stream-request-adapter";

// The unmapped-title cache is session-scoped module state — reset it per test
// so one test's miss cannot short-circuit the next test's mapping.
beforeEach(() => animeMappingTesting.resetUnmappedCache());

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

// SAFETY: deliberately partial test stub — the test only exercises the members it defines.
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
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    canHandle: () => true,
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

// SAFETY: deliberately partial test stub — the test only exercises the members it defines.
const anidbProviderRegistry = {
  get: () => ({
    metadata: {
      id: "anidb",
      name: "AniDB",
      description: "",
      domain: "anidb.app",
      recommended: true,
      isAnimeProvider: true,
      catalogIdentity: "provider-native" as const,
    },
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    canHandle: () => true,
    search: async () => [
      {
        id: "solo-leveling-19413",
        type: "series",
        title: "Solo Leveling",
        year: "2024",
        overview: "",
        posterPath: null,
      },
    ],
  }),
  getAll: () => [],
  getCompatible: () => [],
} as never;

// SAFETY: deliberately partial test stub — the test only exercises the members it defines.
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
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    canHandle: () => true,
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
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    providerRegistry: {
      get: () => {
        throw new Error("provider search should not run");
      },
    } as never,
  });
  expect(mapped).toBe(providerNative);
});

test("AniDB mapping never stores an AllAnime opaque id under providerNativeIds.anidb", async () => {
  let allMangaCalls = 0;
  const mapped = await mapAnimeDiscoveryResultToProviderNative(discovery, {
    mode: "anime",
    providerId: "anidb",
    animeLanguageProfile: { audio: "original", subtitle: "en" },
    providerRegistry: anidbProviderRegistry,
    searchProviderNative: async () => {
      allMangaCalls += 1;
      return [
        {
          id: "LrLqaxWbfzjShWbXW",
          title: "Solo Leveling",
          type: "series",
          aniListId: 151807,
        },
      ];
    },
  });

  expect(allMangaCalls).toBe(0);
  expect(mapped.id).toBe("solo-leveling-19413");
  expect(mapped.externalIds?.providerNativeIds?.anidb).toBe("solo-leveling-19413");
  expect(mapped.externalIds?.providerNativeIds?.allanime).toBeUndefined();
  expect(mapped.externalIds?.anilistId).toBe("151807");
});

test("AniDB mapping rejects a non-AniDB native result and retains catalog identity", async () => {
  const mapped = await mapAnimeDiscoveryResultToProviderNative(discovery, {
    mode: "anime",
    providerId: "anidb",
    animeLanguageProfile: { audio: "original", subtitle: "en" },
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    providerRegistry: {
      get: () => ({
        metadata: {
          id: "anidb",
          name: "AniDB",
          description: "",
          domain: "anidb.app",
          recommended: true,
          isAnimeProvider: true,
          catalogIdentity: "provider-native" as const,
        },
        // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
        canHandle: () => true,
        search: async () => [{ id: "LrLqaxWbfzjShWbXW", type: "series", title: "Solo Leveling" }],
      }),
      getAll: () => [],
      getCompatible: () => [],
    } as never,
    searchProviderNative: async () => {
      throw new Error("AllManga search must not run for AniDB");
    },
  });

  expect(mapped.id).toBe("151807");
  expect(mapped.externalIds?.anilistId).toBe("151807");
  expect(mapped.externalIds?.providerNativeIds?.anidb).toBeUndefined();
});

test("an unmapped title does not re-pay the serial provider search on reselection", async () => {
  // Numeric AniList-style id + AniList metadataSource — otherwise the mapping
  // exits before the search tiers and there is nothing to cache.
  const unmapped: SearchResult = { ...discovery, id: "777777" };
  let providerSearchCalls = 0;
  const context = {
    mode: "anime",
    providerId: "anidb",
    animeLanguageProfile: { audio: "original", subtitle: "en" },
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    providerRegistry: {
      get: () => ({
        metadata: {
          id: "anidb",
          name: "AniDB",
          description: "",
          domain: "anidb.app",
          recommended: true,
          isAnimeProvider: true,
          catalogIdentity: "provider-native" as const,
        },
        // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
        canHandle: () => true,
        search: async () => {
          providerSearchCalls += 1;
          return [];
        },
      }),
      getAll: () => [],
      getCompatible: () => [],
    } as never,
    searchProviderNative: async () => [],
  } as const;

  const first = await mapAnimeDiscoveryResultToProviderNative(unmapped, context);
  expect(providerSearchCalls).toBeGreaterThan(0);
  const paidCalls = providerSearchCalls;

  const second = await mapAnimeDiscoveryResultToProviderNative(unmapped, context);
  expect(providerSearchCalls).toBe(paidCalls);
  expect(second.id).toBe(first.id);
});

test("an aborted mapping does not pin an unmapped marker", async () => {
  const unmapped: SearchResult = { ...discovery, id: "888888" };
  let providerSearchCalls = 0;
  const controller = new AbortController();
  controller.abort();
  const context = {
    mode: "anime",
    providerId: "anidb",
    animeLanguageProfile: { audio: "original", subtitle: "en" },
    signal: controller.signal,
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    providerRegistry: {
      get: () => ({
        metadata: {
          id: "anidb",
          name: "AniDB",
          description: "",
          domain: "anidb.app",
          recommended: true,
          isAnimeProvider: true,
          catalogIdentity: "provider-native" as const,
        },
        // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
        canHandle: () => true,
        search: async () => {
          providerSearchCalls += 1;
          return [];
        },
      }),
      getAll: () => [],
      getCompatible: () => [],
    } as never,
    searchProviderNative: async () => [],
  } as const;

  await mapAnimeDiscoveryResultToProviderNative(unmapped, context);
  const paidCalls = providerSearchCalls;
  expect(paidCalls).toBeGreaterThan(0);

  // The aborted pass must not have been recorded — a follow-up selection pays
  // the search again rather than trusting a cancellation as "no mapping".
  const retry = await mapAnimeDiscoveryResultToProviderNative(unmapped, {
    ...context,
    signal: undefined,
  });
  expect(providerSearchCalls).toBeGreaterThan(paidCalls);
  expect(retry.id).toBe("888888");
});
