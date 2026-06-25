import { describe, expect, test } from "bun:test";

import { normalizeSearchIntent } from "@/domain/search/SearchIntent";
import type { SearchResult, ProviderMetadata } from "@/domain/types";
import { searchTitles } from "@/services/search/SearchRoutingService";

describe("searchTitles", () => {
  test("uses provider-native anime search for anime providers", async () => {
    const provider: any = {
      metadata: {
        id: "allanime",
        name: "AllAnime",
        description: "",
        recommended: true,
        isAnimeProvider: true,
        domain: "allanime.day",
      } as ProviderMetadata,
      search: async () => [{ id: "anime-1", title: "Mob Psycho 100", type: "series", epCount: 12 }],
    };

    const searchRegistry = createSearchRegistry({
      defaultResults: [
        {
          id: "tmdb-1",
          type: "series",
          title: "Wrong Result",
          year: "",
          overview: "",
          posterPath: null,
        },
      ],
    });

    const providerRegistry: any = {
      get: (id: string) => (id === "allanime" ? provider : undefined),
    };

    const result = await searchTitles("mob", {
      mode: "anime",
      providerId: "allanime",
      animeLanguageProfile: { audio: "original", subtitle: "en" },
      searchRegistry: searchRegistry as any,
      providerRegistry,
      enrichAnimeMetadata: false,
    });

    expect(result.strategy).toBe("provider-native");
    expect(result.sourceId).toBe("allanime");
    expect(result.results).toEqual([
      {
        id: "anime-1",
        type: "series",
        title: "Mob Psycho 100",
        year: "",
        overview: "",
        posterPath: null,
        rating: null,
        popularity: null,
        episodeCount: 12,
      },
    ]);
  });

  test("preserves provider-native metadata v2 fields during anime search normalization", async () => {
    const provider: any = {
      metadata: {
        id: "allanime",
        name: "AllAnime",
        description: "",
        recommended: true,
        isAnimeProvider: true,
        domain: "allanime.day",
      } as ProviderMetadata,
      search: async () => [
        {
          id: "anime-1",
          title: "Mob Psycho 100",
          type: "series",
          epCount: 12,
          externalIds: { anilistId: "21507", malId: "32182" },
          release: {
            availableAt: "2026-05-19T12:30:00.000Z",
            status: "released",
            providerConfirmed: true,
          },
          artwork: {
            posterUrl: "https://cdn.example/poster.jpg",
            seekBarVttUrl: "https://cdn.example/seek.vtt",
          },
          languageEvidence: [
            {
              role: "hardsub",
              normalizedLanguage: "en",
              nativeLabel: "Hard Sub",
              confidence: 0.9,
            },
          ],
        },
      ],
    };

    const result = await searchTitles("mob", {
      mode: "anime",
      providerId: "allanime",
      animeLanguageProfile: { audio: "original", subtitle: "en" },
      searchRegistry: createSearchRegistry({}) as any,
      providerRegistry: { get: () => provider } as any,
      enrichAnimeMetadata: false,
    });

    expect(result.results[0]?.externalIds?.malId).toBe("32182");
    expect(result.results[0]?.release?.providerConfirmed).toBe(true);
    expect(result.results[0]?.artwork?.seekBarVttUrl).toContain("seek.vtt");
    expect(result.results[0]?.languageEvidence?.[0]?.nativeLabel).toBe("Hard Sub");
  });

  test("uses registry-backed search for non-anime providers", async () => {
    const searchRegistry = createSearchRegistry({
      providerResults: [
        {
          id: "tmdb-2",
          type: "movie",
          title: "Dune",
          year: "2021",
          overview: "Spice.",
          posterPath: null,
        },
      ],
    });

    const providerRegistry: any = {
      get: (id: string) =>
        id === "vidking"
          ? {
              metadata: {
                id: "vidking",
                name: "VidKing",
                description: "",
                recommended: true,
                isAnimeProvider: false,
                domain: "vidking.net",
              },
            }
          : undefined,
    };

    const result = await searchTitles("dune", {
      mode: "series",
      providerId: "vidking",
      animeLanguageProfile: { audio: "original", subtitle: "en" },
      searchRegistry: searchRegistry as any,
      providerRegistry,
    });

    expect(result.strategy).toBe("registry");
    expect(result.sourceId).toBe("tmdb");
    expect(result.results[0]?.id).toBe("tmdb-2");
  });

  test("passes advanced intent to the registry and reports filter evidence", async () => {
    let received: unknown;
    const searchRegistry = createSearchRegistry({
      providerResults: [
        {
          id: "tmdb-3",
          type: "series",
          title: "Filtered Series",
          year: "2024",
          overview: "",
          posterPath: null,
        },
      ],
      onSearch: (_query, _signal, intent) => {
        received = intent;
      },
    });

    const providerRegistry: any = {
      get: () => ({
        metadata: {
          id: "vidking",
          name: "VidKing",
          description: "",
          recommended: true,
          isAnimeProvider: false,
          domain: "vidking.net",
        },
      }),
    };

    const intent = normalizeSearchIntent({
      query: "",
      mode: "series",
      filters: { type: "series", genres: ["drama"], minRating: 8, watched: "watching" },
      sort: "popular",
    });

    const result = await searchTitles(intent, {
      mode: "series",
      providerId: "vidking",
      animeLanguageProfile: { audio: "original", subtitle: "en" },
      searchRegistry: searchRegistry as any,
      providerRegistry,
    });

    expect(received).toEqual(intent);
    expect(result.strategy).toBe("registry");
    expect(result.evidence).toEqual({
      upstream: ["type series", "genre drama", "rating >= 8", "sort popular"],
      local: [],
      unsupported: ["watched watching"],
    });
  });

  test("uses AniList-backed registry search for advanced anime filters before provider-native search", async () => {
    let providerNativeCalls = 0;
    const provider: any = {
      metadata: {
        id: "allanime",
        name: "AllAnime",
        description: "",
        recommended: true,
        isAnimeProvider: true,
        domain: "allanime.day",
      } as ProviderMetadata,
      search: async () => {
        providerNativeCalls += 1;
        return [{ id: "anime-provider", title: "Provider Result", type: "series" }];
      },
    };

    const searchRegistry = createSearchRegistry({
      animeResults: [
        {
          id: "anilist-1",
          type: "series",
          title: "AniList Filtered",
          year: "2024",
          overview: "",
          posterPath: null,
        },
      ],
    });

    const providerRegistry: any = {
      get: (id: string) => (id === "allanime" ? provider : undefined),
    };

    const result = await searchTitles(
      normalizeSearchIntent({
        query: "",
        mode: "anime",
        filters: { genres: ["action"], minRating: 7 },
        sort: "rating",
      }),
      {
        mode: "anime",
        providerId: "allanime",
        animeLanguageProfile: { audio: "original", subtitle: "en" },
        searchRegistry: searchRegistry as any,
        providerRegistry,
        enrichAnimeMetadata: false,
      },
    );

    expect(providerNativeCalls).toBe(0);
    expect(result.strategy).toBe("registry");
    expect(result.sourceId).toBe("anilist");
    expect(result.results[0]?.id).toBe("anilist-1");
    expect(result.evidence.upstream).toEqual(["genre action", "rating >= 7", "sort rating"]);
  });

  test("routes mode anime filters through the anime search service even from series mode", async () => {
    let searchedProvider: string | undefined;
    const searchRegistry = createSearchRegistry({
      animeResults: [
        {
          id: "anilist-cross-mode",
          type: "series",
          title: "Cross Mode Anime",
          year: "2025",
          overview: "",
          posterPath: null,
        },
      ],
      onProviderResolution: (providerId) => {
        searchedProvider = providerId;
      },
    });

    const providerRegistry: any = {
      get: (id: string) => ({
        metadata: {
          id,
          name: id,
          description: "",
          recommended: true,
          isAnimeProvider: id === "allanime",
          domain: `${id}.test`,
        },
      }),
      getDefault: (isAnime: boolean) => ({
        metadata: {
          id: isAnime ? "allanime" : "vidking",
          name: isAnime ? "AllAnime" : "VidKing",
          description: "",
          recommended: true,
          isAnimeProvider: isAnime,
          domain: isAnime ? "allanime.day" : "vidking.net",
        },
      }),
    };

    const result = await searchTitles(
      normalizeSearchIntent({
        query: "",
        mode: "anime",
        filters: { genres: ["action"] },
        sort: "popular",
      }),
      {
        mode: "series",
        providerId: "vidking",
        animeLanguageProfile: { audio: "original", subtitle: "en" },
        searchRegistry: searchRegistry as any,
        providerRegistry,
      },
    );

    expect(searchedProvider).toBe("allanime");
    expect(result.sourceId).toBe("anilist");
    expect(result.results[0]?.id).toBe("anilist-cross-mode");
    expect(result.evidence.upstream).toEqual(["mode anime", "genre action", "sort popular"]);
  });

  test("keeps advanced youtube searches on the youtube provider instead of registry fallback", async () => {
    let providerNativeCalls = 0;
    let searchedProvider: string | undefined;
    const provider: any = {
      metadata: {
        id: "youtube",
        name: "YouTube",
        description: "",
        recommended: true,
        isAnimeProvider: false,
        isYoutubeProvider: true,
        domain: "youtube.com",
      } as ProviderMetadata,
      search: async () => {
        providerNativeCalls += 1;
        return [
          {
            id: "youtube:abc123",
            title: "YouTube Result",
            type: "movie",
            contentShape: "video",
            externalIds: { youtubeId: "abc123" },
          },
        ];
      },
    };

    const result = await searchTitles(
      normalizeSearchIntent({
        query: "lofi",
        mode: "youtube",
        filters: { provider: "youtube", subtitles: "en" },
        sort: "popular",
      }),
      {
        mode: "youtube",
        providerId: "youtube",
        animeLanguageProfile: { audio: "original", subtitle: "en" },
        youtubeLanguageProfile: { audio: "original", subtitle: "en", quality: "best" },
        searchRegistry: createSearchRegistry({
          defaultResults: [
            {
              id: "tmdb-wrong",
              type: "movie",
              title: "Wrong Registry Result",
              year: "",
              overview: "",
              posterPath: null,
            },
          ],
          onProviderResolution: (providerId) => {
            searchedProvider = providerId;
          },
        }) as any,
        providerRegistry: { get: () => provider } as any,
      },
    );

    expect(providerNativeCalls).toBe(1);
    expect(searchedProvider).toBeUndefined();
    expect(result.strategy).toBe("provider-native");
    expect(result.sourceId).toBe("youtube");
    expect(result.results[0]?.id).toBe("youtube:abc123");
    expect(result.evidence.unsupported).toEqual([
      "provider youtube",
      "subtitles en",
      "sort popular",
    ]);
  });

  test("routes mode youtube filters through the youtube provider from series mode", async () => {
    let providerNativeCalls = 0;
    const provider: any = {
      metadata: {
        id: "youtube",
        name: "YouTube",
        description: "",
        recommended: true,
        isAnimeProvider: false,
        isYoutubeProvider: true,
        domain: "youtube.com",
      } as ProviderMetadata,
      search: async () => {
        providerNativeCalls += 1;
        return [
          {
            id: "youtube:cross-mode",
            title: "Cross Mode YouTube",
            type: "movie",
            contentShape: "video",
            externalIds: { youtubeId: "cross-mode" },
          },
        ];
      },
    };

    const result = await searchTitles(
      normalizeSearchIntent({
        query: "music",
        mode: "youtube",
        filters: {},
        sort: "relevance",
      }),
      {
        mode: "series",
        providerId: "vidking",
        animeLanguageProfile: { audio: "original", subtitle: "en" },
        searchRegistry: createSearchRegistry({}) as any,
        providerRegistry: {
          get: (id: string) => (id === "youtube" ? provider : undefined),
          getDefaultForMode: (mode: string) => {
            expect(mode).toBe("youtube");
            return provider;
          },
        } as any,
      },
    );

    expect(providerNativeCalls).toBe(1);
    expect(result.strategy).toBe("provider-native");
    expect(result.sourceId).toBe("youtube");
    expect(result.results[0]?.id).toBe("youtube:cross-mode");
  });

  test("applies text search filters locally when TMDB search cannot push them upstream", async () => {
    const searchRegistry = createSearchRegistry({
      providerResults: [
        {
          id: "tmdb-low",
          type: "series",
          title: "Low Rated",
          year: "2024",
          overview: "",
          posterPath: null,
          rating: 6,
        },
        {
          id: "tmdb-high",
          type: "series",
          title: "High Rated",
          year: "2024",
          overview: "",
          posterPath: null,
          rating: 8.7,
        },
      ],
    });
    const providerRegistry: any = {
      get: () => ({
        metadata: {
          id: "vidking",
          name: "VidKing",
          description: "",
          recommended: true,
          isAnimeProvider: false,
          domain: "vidking.net",
        },
      }),
    };

    const result = await searchTitles(
      normalizeSearchIntent({
        query: "office",
        mode: "series",
        filters: { type: "series", minRating: 8, genres: ["comedy"] },
        sort: "rating",
      }),
      {
        mode: "series",
        providerId: "vidking",
        animeLanguageProfile: { audio: "original", subtitle: "en" },
        searchRegistry: searchRegistry as any,
        providerRegistry,
      },
    );

    expect(result.results.map((r) => r.id)).toEqual(["tmdb-high"]);
    expect(result.evidence).toEqual({
      upstream: [],
      local: ["type series", "rating >= 8", "sort rating"],
      unsupported: ["genre comedy"],
    });
  });
});

function createSearchRegistry({
  providerResults = [],
  defaultResults = [],
  animeResults = [],
  onSearch,
  onProviderResolution,
}: {
  providerResults?: SearchResult[];
  defaultResults?: SearchResult[];
  animeResults?: SearchResult[];
  onSearch?: (query: string, signal?: AbortSignal, intent?: any) => void;
  onProviderResolution?: (providerId: string) => void;
}) {
  const providerService = {
    metadata: { id: "tmdb", name: "TMDB", description: "" },
    compatibleProviders: ["vidking"],
    search: async (query: string, signal?: AbortSignal, intent?: any) => {
      onSearch?.(query, signal, intent);
      return providerResults;
    },
    getTitleDetails: async () => null,
  };

  const animeService = {
    metadata: { id: "anilist", name: "AniList", description: "" },
    compatibleProviders: ["allanime"],
    search: async () => animeResults,
    getTitleDetails: async () => null,
  };

  const defaultService = {
    metadata: { id: "default", name: "Default", description: "" },
    compatibleProviders: [],
    search: async () => defaultResults,
    getTitleDetails: async () => null,
  };

  return {
    getForProvider(providerId: string) {
      onProviderResolution?.(providerId);
      if (providerId === "allanime") return animeService;
      return providerId === "vidking" ? providerService : undefined;
    },
    getDefault() {
      return defaultService;
    },
  };
}
