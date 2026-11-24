import { afterEach, describe, expect, test } from "bun:test";

import { createSearchIntentEngine } from "@/domain/search/SearchIntentEngine";
import type { SearchResult } from "@/domain/types";
import {
  catalogAnswersSnapshot,
  resetCatalogSourceLedgerForTest,
} from "@/services/catalog/catalog-source-ledger";
import type { searchWikidataTmdbTitles } from "@/services/catalog/wikidata-search";
import type { ProviderRegistry } from "@/services/providers/ProviderRegistry";
import type { SearchRegistry } from "@/services/search/SearchRegistry";
import { searchTitles, type SearchRoutingContext } from "@/services/search/SearchRoutingService";
import type { SearchService } from "@/services/search/SearchService";

afterEach(() => resetCatalogSourceLedgerForTest());

const DUNE: SearchResult = {
  id: "438631",
  type: "movie",
  title: "Dune",
  year: "2021",
  overview: "",
  posterPath: null,
  metadataSource: "Wikidata",
  isAnime: false,
  externalIds: { tmdbId: "438631" },
};

function tmdbService(search: SearchService["search"]): SearchService {
  return {
    metadata: { id: "tmdb", name: "TMDB / Videasy", description: "" },
    servesCatalog: "tmdb",
    compatibleProviders: [],
    search,
    getTitleDetails: async () => null,
  };
}

function context(
  service: SearchService,
  searchWikidata: typeof searchWikidataTmdbTitles,
  signal?: AbortSignal,
): SearchRoutingContext {
  const registry: Pick<SearchRegistry, "getDefault" | "getForProvider"> = {
    getDefault: () => service,
    getForProvider: () => service,
  };
  const vidking = {
    metadata: {
      id: "vidking",
      name: "VidKing",
      description: "",
      isAnimeProvider: false,
      domain: "vidking.net",
    },
  };
  // SAFETY: deliberately partial stub — the routing path under test reads only `get` and `getAll`.
  const providerRegistry = {
    get: (id: string) => (id === "vidking" ? vidking : undefined),
    getAll: () => [vidking],
  } as ProviderRegistry;
  const routing: SearchRoutingContext = {
    mode: "series",
    providerId: "vidking",
    animeLanguageProfile: { audio: "original", subtitle: "en", quality: "1080p" },
    searchRegistry: registry,
    providerRegistry,
    searchWikidata,
  };
  if (signal) routing.signal = signal;
  return routing;
}

const tmdbDown = tmdbService(async () => {
  throw new Error("TMDB search failed: every host unreachable");
});

describe("movie/series search when every TMDB route fails", () => {
  test("Wikidata answers with TMDB ids, and the source is named", async () => {
    const queries: string[] = [];
    const result = await searchTitles(
      "dune",
      context(tmdbDown, async (query) => {
        queries.push(query);
        return [DUNE];
      }),
    );

    expect(queries).toEqual(["dune"]);
    expect(result.results.map((entry) => entry.id)).toEqual(["438631"]);
    expect(result.sourceId).toBe("wikidata");
    expect(result.sourceName).toBe("Wikidata (TMDB unreachable)");
    expect(result.diagnosis).toEqual({ code: "catalog-fallback", sourceId: "tmdb" });
    expect(catalogAnswersSnapshot()).toMatchObject([
      { capability: "search", lane: "movie-series", sourceId: "wikidata", fallback: true },
    ]);
  });

  test("a healthy TMDB never consults Wikidata and is recorded as the primary", async () => {
    let consulted = false;
    const healthy = tmdbService(async () => [{ ...DUNE, metadataSource: undefined }]);
    const result = await searchTitles(
      "dune",
      context(healthy, async () => {
        consulted = true;
        return [];
      }),
    );

    expect(consulted).toBe(false);
    expect(result.sourceId).toBe("tmdb");
    expect(catalogAnswersSnapshot()).toMatchObject([{ sourceId: "tmdb", fallback: false }]);
  });

  test("an honest empty Wikidata answer is returned, with the fallback diagnosis", async () => {
    const result = await searchTitles(
      "zzqqxx",
      context(tmdbDown, async () => []),
    );
    expect(result.results).toEqual([]);
    expect(result.diagnosis?.code).toBe("catalog-fallback");
  });

  test("when Wikidata is down too, the original TMDB error surfaces", async () => {
    await expect(
      searchTitles(
        "dune",
        context(tmdbDown, async () => {
          throw new Error("Wikidata search is unavailable: search HTTP 503");
        }),
      ),
    ).rejects.toThrow("TMDB search failed");
  });

  test("a filtered search is not answered from Wikidata", async () => {
    let consulted = false;
    const intent = createSearchIntentEngine().fromText("dune type:movie year:2021", {
      currentMode: "series",
    }).intent;
    await expect(
      searchTitles(
        intent,
        context(tmdbDown, async () => {
          consulted = true;
          return [DUNE];
        }),
      ),
    ).rejects.toThrow();
    expect(consulted).toBe(false);
  });

  test("a successful filtered search replaces the fallback record", async () => {
    await searchTitles(
      "dune",
      context(tmdbDown, async () => [DUNE]),
    );
    const intent = createSearchIntentEngine().fromText("dune type:movie", {
      currentMode: "series",
    }).intent;
    const healthy = tmdbService(async () => [{ ...DUNE, metadataSource: undefined }]);
    await searchTitles(
      intent,
      context(healthy, async () => []),
    );
    expect(catalogAnswersSnapshot()).toMatchObject([
      { capability: "search", sourceId: "tmdb", fallback: false },
    ]);
  });

  test("a cancelled search propagates instead of falling back", async () => {
    const controller = new AbortController();
    let consulted = false;
    const cancelling = tmdbService(async () => {
      controller.abort();
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    await expect(
      searchTitles(
        "dune",
        context(
          cancelling,
          async () => {
            consulted = true;
            return [DUNE];
          },
          controller.signal,
        ),
      ),
    ).rejects.toThrow();
    expect(consulted).toBe(false);
  });
});
