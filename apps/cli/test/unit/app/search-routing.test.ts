import { describe, expect, test } from "bun:test";

import { searchTitles } from "@/app/search-routing";
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
      animeLang: "sub",
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
      animeLang: "sub",
      searchRegistry: searchRegistry as any,
      providerRegistry,
    });

    expect(result.strategy).toBe("registry");
    expect(result.sourceId).toBe("tmdb");
    expect(result.results[0]?.id).toBe("tmdb-2");
  });
});

function createSearchRegistry({
  providerResults = [],
  defaultResults = [],
}: {
  providerResults?: SearchResult[];
  defaultResults?: SearchResult[];
}) {
  const providerService = {
    metadata: { id: "tmdb", name: "TMDB", description: "" },
    compatibleProviders: ["vidking"],
    search: async () => providerResults,
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
      return providerId === "vidking" ? providerService : undefined;
    },
    getDefault() {
      return defaultService;
    },
  };
}
