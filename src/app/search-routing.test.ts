import { describe, expect, test } from "bun:test";

import { searchTitles } from "./search-routing";
import type { SearchResult } from "../domain/types";
import type { SearchRegistry } from "../services/search/SearchRegistry";
import type { Provider } from "../providers";

describe("searchTitles", () => {
  test("uses provider-native anime search for anime providers", async () => {
    const provider: Provider = {
      kind: "api",
      id: "allanime",
      name: "AllAnime",
      description: "",
      domain: "allanime.day",
      isAnimeProvider: true,
      searchBackend: "allanime",
      async search() {
        return [{ id: "anime-1", title: "Mob Psycho 100", type: "series", epCount: 12 }];
      },
      async resolveStream() {
        return null;
      },
    };

    const registry = createRegistry({
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

    const result = await searchTitles("mob", {
      mode: "anime",
      providerId: "allanime",
      animeLang: "sub",
      searchRegistry: registry,
      lookupProvider: () => provider,
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
      },
    ]);
  });

  test("uses registry-backed search for non-anime providers", async () => {
    const registry = createRegistry({
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

    const result = await searchTitles("dune", {
      mode: "series",
      providerId: "vidking",
      animeLang: "sub",
      searchRegistry: registry,
      lookupProvider: () =>
        ({
          kind: "playwright",
          id: "vidking",
          name: "VidKing",
          description: "",
          domain: "vidking.net",
          movieUrl: () => "",
          seriesUrl: () => "",
          needsClick: false,
          titleSource: "page-title",
        }) satisfies Provider,
    });

    expect(result.strategy).toBe("registry");
    expect(result.sourceId).toBe("tmdb");
    expect(result.results[0]?.id).toBe("tmdb-2");
  });
});

function createRegistry({
  providerResults = [],
  defaultResults = [],
}: {
  providerResults?: SearchResult[];
  defaultResults?: SearchResult[];
}): Pick<SearchRegistry, "getDefault" | "getForProvider"> {
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
    getForProvider(providerId) {
      return providerId === "vidking" ? providerService : undefined;
    },
    getDefault() {
      return defaultService;
    },
  };
}
