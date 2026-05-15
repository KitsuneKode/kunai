import { describe, expect, test } from "bun:test";

import { searchTitles } from "@/app/search-routing";
import { normalizeSearchIntent } from "@/domain/search/SearchIntent";
import type { SearchResult, ProviderMetadata } from "@/domain/types";

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
}: {
  providerResults?: SearchResult[];
  defaultResults?: SearchResult[];
  animeResults?: SearchResult[];
  onSearch?: (query: string, signal?: AbortSignal, intent?: any) => void;
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
      if (providerId === "allanime") return animeService;
      return providerId === "vidking" ? providerService : undefined;
    },
    getDefault() {
      return defaultService;
    },
  };
}
