import { describe, expect, test } from "bun:test";

import { withFreshnessLabel } from "@/app/discover/discover-sections";
import type { SearchResult } from "@/domain/types";
import { createCatalogDurableCache } from "@/services/catalog/catalog-durable-cache";
import {
  CatalogDiscoveryService,
  type CatalogDurableCache,
} from "@/services/catalog/CatalogDiscoveryService";
import {
  JikanTrendingUnavailableError,
  loadJikanAnimeTrending,
  parseJikanDurationMinutes,
} from "@/services/catalog/jikan-trending";
import {
  animeSeasonOf,
  KitsuTrendingUnavailableError,
  kitsuSeasonalPopularUrl,
  loadKitsuAnimeTrending,
} from "@/services/catalog/kitsu-trending";
import { openKunaiDatabase, RecommendationCacheRepository, runMigrations } from "@kunai/storage";

const NOW = Date.parse("2026-11-23T12:00:00.000Z");

function item(id: string, title: string): SearchResult {
  return { id, type: "series", title, year: "2026", overview: "", posterPath: null };
}

function memoryDurable(): CatalogDurableCache & { readonly rows: Map<string, unknown> } {
  const rows = new Map<string, { cachedAt: number; results: readonly SearchResult[] }>();
  return {
    rows,
    read: (key) => rows.get(key) ?? null,
    write: (key, cachedAt, results) => {
      rows.set(key, { cachedAt, results });
    },
  };
}

const down = async (): Promise<readonly SearchResult[]> => {
  throw new Error("upstream down");
};

function service(
  anime: () => Promise<readonly SearchResult[]>,
  fallback: () => Promise<readonly SearchResult[]>,
  durable: CatalogDurableCache,
  now: () => number = () => NOW,
) {
  return new CatalogDiscoveryService({ anime, tmdb: down }, now, {
    fallbacks: { anime: [{ id: "jikan", load: fallback }] },
    durableCache: () => durable,
  });
}

describe("trending source chain", () => {
  test("primary down → the fallback answers and is remembered as last-known-good", async () => {
    const durable = memoryDurable();
    const section = await service(
      down,
      async () => [item("1", "Frieren")],
      durable,
    ).loadTrendingSection("anime");
    expect(section.sourceId).toBe("jikan");
    expect(section.staleSince).toBeUndefined();
    expect(section.results.map((r) => r.title)).toEqual(["Frieren"]);
    expect(durable.read("catalog:trending:anime")?.cachedAt).toBe(NOW);
  });

  test("every live source down → the last good list, marked with its age", async () => {
    const durable = memoryDurable();
    durable.write("catalog:trending:anime", NOW - 3 * 3_600_000, [item("1", "Frieren")]);
    const section = await service(down, down, durable).loadTrendingSection("anime");
    expect(section.sourceId).toBe("last-known-good");
    expect(section.staleSince).toBe(NOW - 3 * 3_600_000);
    expect(section.results.map((r) => r.title)).toEqual(["Frieren"]);
  });

  test("nothing live and nothing remembered → the failure propagates (callers show empty)", async () => {
    await expect(service(down, down, memoryDurable()).loadTrendingSection("anime")).rejects.toThrow(
      "upstream down",
    );
  });

  test("a stale answer is reused only briefly, then the live chain is retried", async () => {
    const durable = memoryDurable();
    durable.write("catalog:trending:anime", NOW - 3_600_000, [item("1", "Old")]);
    let clock = NOW;
    let primaryCalls = 0;
    let primaryUp = false;
    const discovery = service(
      async () => {
        primaryCalls += 1;
        if (!primaryUp) throw new Error("down");
        return [item("2", "New")];
      },
      down,
      durable,
      () => clock,
    );
    expect((await discovery.loadTrendingSection("anime")).sourceId).toBe("last-known-good");
    expect((await discovery.loadTrendingSection("anime")).sourceId).toBe("last-known-good");
    expect(primaryCalls).toBe(1);

    primaryUp = true;
    clock += 61_000;
    const recovered = await discovery.loadTrendingSection("anime");
    expect(recovered.sourceId).toBe("anilist");
    expect(recovered.results.map((r) => r.title)).toEqual(["New"]);
  });

  test("a caller abort stops the walk: no fallback request, no stale answer", async () => {
    const controller = new AbortController();
    let fallbackCalls = 0;
    const durable = memoryDurable();
    durable.write("catalog:trending:anime", NOW, [item("1", "Old")]);
    const discovery = service(
      async () => {
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      },
      async () => {
        fallbackCalls += 1;
        return [item("2", "Fallback")];
      },
      durable,
    );
    await expect(discovery.loadTrendingSection("anime", controller.signal)).rejects.toThrow();
    expect(fallbackCalls).toBe(0);
  });

  test("concurrent callers share one walk of the chain", async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;
    const discovery = service(
      async () => {
        primaryCalls += 1;
        throw new Error("down");
      },
      async () => {
        fallbackCalls += 1;
        return [item("1", "Frieren")];
      },
      memoryDurable(),
    );
    const [a, b] = await Promise.all([
      discovery.loadTrendingSection("anime"),
      discovery.loadTrendingSection("anime"),
    ]);
    expect(a.sourceId).toBe("jikan");
    expect(b.sourceId).toBe("jikan");
    expect(primaryCalls).toBe(1);
    expect(fallbackCalls).toBe(1);
  });
});

describe("durable catalog cache on the real repository", () => {
  test("a list survives past any freshness TTL until the retention window", () => {
    const db = openKunaiDatabase(":memory:");
    runMigrations(db, "cache");
    const repository = new RecommendationCacheRepository(db);
    const cache = createCatalogDurableCache(repository, 14 * 86_400_000);
    const written = Date.now() - 2 * 86_400_000;
    cache.write("catalog:trending:series", written, [item("1", "Dune")]);
    expect(cache.read("catalog:trending:series")?.cachedAt).toBe(written);

    repository.set(
      "catalog:trending:anime",
      "{not json",
      new Date(Date.now() + 60_000).toISOString(),
      new Date().toISOString(),
    );
    expect(cache.read("catalog:trending:anime")).toBeNull();
  });
});

describe("Jikan fallback", () => {
  const jikanPayload = {
    data: [
      {
        mal_id: 52991,
        title: "Sousou no Frieren",
        title_english: "Frieren: Beyond Journey's End",
        type: "TV",
        episodes: 28,
        duration: "24 min per ep",
        score: 9.3,
        members: 1_000_000,
        year: 2023,
        images: { jpg: { large_image_url: "https://cdn.myanimelist.net/x.jpg" } },
      },
      { mal_id: 1, title: "Unmapped", type: "TV" },
    ],
  };
  const fetchImpl = Object.assign(async () => Response.json(jikanPayload), {
    preconnect: globalThis.fetch.preconnect,
  });

  test("maps through ARM to AniList ids and drops entries ARM cannot map", async () => {
    const results = await loadJikanAnimeTrending(undefined, {
      fetchImpl,
      lookupArm: async (malId) => (malId === "52991" ? { anilistId: "154587", malId } : null),
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("154587");
    expect(results[0]?.externalIds).toEqual({ anilistId: "154587", malId: "52991" });
    expect(results[0]?.title).toBe("Frieren: Beyond Journey's End");
    expect(results[0]?.isAnime).toBe(true);
    expect(results[0]?.episodeCount).toBe(28);
  });

  test("rejects when nothing maps, so the chain falls through to last-known-good", async () => {
    await expect(
      loadJikanAnimeTrending(undefined, { fetchImpl, lookupArm: async () => null }),
    ).rejects.toBeInstanceOf(JikanTrendingUnavailableError);
  });

  test("parses Jikan durations", () => {
    expect(parseJikanDurationMinutes("24 min per ep")).toBe(24);
    expect(parseJikanDurationMinutes("1 hr 52 min")).toBe(112);
    expect(parseJikanDurationMinutes("Unknown")).toBeUndefined();
  });
});

describe("freshness label", () => {
  test("stale rails say how old they are; live rails are unchanged", () => {
    const section = { label: "Trending this week", reason: "trending" as const, items: [] };
    expect(withFreshnessLabel(section, NOW).label).toBe("Trending this week");
    expect(withFreshnessLabel({ ...section, staleSince: NOW - 3 * 3_600_000 }, NOW).label).toBe(
      "Trending this week · updated 3h ago",
    );
  });
});

describe("Kitsu fallback", () => {
  function kitsuEnvelope(
    entries: readonly { id: string; title: string; anilist?: string; mal?: string }[],
  ) {
    const included: unknown[] = [];
    const data = entries.map((entry) => {
      const refs: { id: string; type: string }[] = [];
      if (entry.anilist) {
        included.push({
          id: `${entry.id}-al`,
          type: "mappings",
          attributes: { externalSite: "anilist/anime", externalId: entry.anilist },
        });
        refs.push({ id: `${entry.id}-al`, type: "mappings" });
      }
      if (entry.mal) {
        included.push({
          id: `${entry.id}-mal`,
          type: "mappings",
          attributes: { externalSite: "myanimelist/anime", externalId: entry.mal },
        });
        refs.push({ id: `${entry.id}-mal`, type: "mappings" });
      }
      return {
        id: entry.id,
        type: "anime",
        attributes: {
          canonicalTitle: entry.title,
          subtype: "TV",
          episodeCount: 12,
          averageRating: "84.5",
          startDate: "2026-10-03",
        },
        relationships: { mappings: { data: refs } },
      };
    });
    return { data, included };
  }

  function routedFetch(routes: { seasonal: unknown; current?: unknown }, calls: string[] = []) {
    return Object.assign(
      async (input: string | URL | Request) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("filter%5Bseason%5D")) return Response.json(routes.seasonal);
        if (routes.current !== undefined) return Response.json(routes.current);
        return new Response("{}", { status: 503 });
      },
      { preconnect: globalThis.fetch.preconnect },
    );
  }

  test("season boundaries follow the broadcast calendar", () => {
    expect(animeSeasonOf(new Date("2026-11-23T00:00:00Z"))).toEqual({ season: "fall", year: 2026 });
    expect(animeSeasonOf(new Date("2027-01-05T00:00:00Z"))).toEqual({
      season: "winter",
      year: 2027,
    });
    expect(kitsuSeasonalPopularUrl(new Date("2026-07-01T00:00:00Z"))).toContain(
      "filter%5Bseason%5D=summer&filter%5BseasonYear%5D=2026",
    );
  });

  test("maps AniList and MAL ids from included mappings; unmapped entries are dropped", async () => {
    const seasonal = kitsuEnvelope([
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `${index}`,
        title: `Show ${index}`,
        anilist: `${100 + index}`,
        mal: `${200 + index}`,
      })),
      { id: "x", title: "No AniList" },
    ]);
    const calls: string[] = [];
    const results = await loadKitsuAnimeTrending(
      undefined,
      routedFetch({ seasonal }, calls),
      new Date("2026-11-23T00:00:00Z"),
    );
    expect(results.map((r) => r.id)).toEqual(["100", "101", "102", "103", "104", "105"]);
    expect(results[0]?.externalIds).toEqual({ anilistId: "100", malId: "200" });
    // Kitsu rates 0–100; rails use 0–10.
    expect(results[0]?.rating).toBe(8.5);
    // A full seasonal list needs no second request.
    expect(calls).toHaveLength(1);
  });

  test("a thin early-season list is topped up from currently airing, without duplicates", async () => {
    const seasonal = kitsuEnvelope([{ id: "1", title: "New", anilist: "1" }]);
    const current = kitsuEnvelope([
      { id: "1", title: "New", anilist: "1" },
      { id: "2", title: "Long runner", anilist: "2" },
    ]);
    const results = await loadKitsuAnimeTrending(undefined, routedFetch({ seasonal, current }));
    expect(results.map((r) => r.id)).toEqual(["1", "2"]);
  });

  test("rejects when nothing maps, so the chain moves on", async () => {
    const empty = kitsuEnvelope([{ id: "x", title: "No AniList" }]);
    await expect(
      loadKitsuAnimeTrending(undefined, routedFetch({ seasonal: empty, current: empty })),
    ).rejects.toBeInstanceOf(KitsuTrendingUnavailableError);
  });
});
