import { describe, expect, test } from "bun:test";

import { withFreshnessLabel } from "@/app/discover/discover-sections";
import type { SearchResult } from "@/domain/types";
import {
  catalogAnswersSnapshot,
  recordCatalogAnswer,
} from "@/services/catalog/catalog-source-ledger";
import {
  CatalogDiscoveryService,
  type CatalogDurableCache,
} from "@/services/catalog/CatalogDiscoveryService";
import { createCatalogDurableCache } from "@/services/catalog/durable-json-cache";
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
  const rows = new Map<
    string,
    { cachedAt: number; results: readonly SearchResult[]; sourceId?: string }
  >();
  return {
    rows,
    read: (key) => rows.get(key) ?? null,
    write: (key, cachedAt, results, sourceId) => {
      rows.set(key, sourceId ? { cachedAt, results, sourceId } : { cachedAt, results });
    },
  };
}

const down = async (): Promise<readonly SearchResult[]> => {
  throw new Error("upstream down");
};

function service(
  anime: (signal?: AbortSignal) => Promise<readonly SearchResult[]>,
  fallback: (signal?: AbortSignal) => Promise<readonly SearchResult[]>,
  durable: CatalogDurableCache,
  now: () => number = () => NOW,
  hedgeAfterMs = -1,
) {
  return new CatalogDiscoveryService({ anime, tmdb: down }, now, {
    fallbacks: { anime: [{ id: "jikan", load: fallback }] },
    durableCache: () => durable,
    hedgeAfterMs,
  });
}

describe("trending source chain", () => {
  test("clearing trending stops the walk already in flight", async () => {
    let walkSignal: AbortSignal | undefined;
    const hanging = (signal?: AbortSignal) => {
      walkSignal = signal;
      return new Promise<readonly SearchResult[]>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    };
    const svc = service(hanging, down, memoryDurable());
    const pending = svc.loadTrendingSection("anime").catch(() => "rejected");
    svc.clearTrendingCache();
    expect(walkSignal?.aborted).toBe(true);
    await pending;
  });

  test("a cached section still updates /diagnostics' source record", async () => {
    const svc = service(async () => [item("1", "Live")], down, memoryDurable());
    await svc.loadTrendingSection("anime");
    recordCatalogAnswer({
      capability: "trending",
      lane: "anime",
      sourceId: "last-known-good",
      sourceName: "saved list",
      fallback: true,
      reason: "AniList unavailable",
    });
    // Served from the in-memory cache: the record must say AniList again.
    await svc.loadTrendingSection("anime");
    expect(catalogAnswersSnapshot()).toMatchObject([
      { capability: "trending", lane: "anime", sourceId: "anilist", fallback: false },
    ]);
  });

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

    // Valid envelope, unrenderable items: treated as no last good answer.
    cache.write("catalog:trending:youtube", written, [null, { id: "1" }] as never);
    expect(cache.read("catalog:trending:youtube")).toBeNull();
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

describe("shared walks: cancellation, refresh races, hedging", () => {
  test("one caller cancelling does not cancel another caller's fallback", async () => {
    const primary = Promise.withResolvers<readonly SearchResult[]>();
    let fallbackCalls = 0;
    const discovery = service(
      () => primary.promise,
      async () => {
        fallbackCalls += 1;
        return [item("1", "Fallback")];
      },
      memoryDurable(),
    );
    const first = new AbortController();
    const firstWait = discovery.loadTrendingSection("anime", first.signal);
    const secondWait = discovery.loadTrendingSection("anime");
    first.abort();
    await expect(firstWait).rejects.toThrow();
    primary.reject(new Error("down"));
    const second = await secondWait;
    expect(second.sourceId).toBe("jikan");
    expect(fallbackCalls).toBe(1);
  });

  test("the walk stops once its last waiter leaves", async () => {
    let walkSignal: AbortSignal | undefined;
    const primary = Promise.withResolvers<readonly SearchResult[]>();
    const discovery = service(
      (signal) => {
        walkSignal = signal;
        return primary.promise;
      },
      down,
      memoryDurable(),
    );
    const caller = new AbortController();
    const wait = discovery.loadTrendingSection("anime", caller.signal);
    caller.abort();
    await expect(wait).rejects.toThrow();
    expect(walkSignal?.aborted).toBe(true);
  });

  test("a walk started before a refresh cannot overwrite the newer answer", async () => {
    const durable = memoryDurable();
    const older = Promise.withResolvers<readonly SearchResult[]>();
    const newer = Promise.withResolvers<readonly SearchResult[]>();
    let call = 0;
    const discovery = service(() => (call++ === 0 ? older.promise : newer.promise), down, durable);
    const a = discovery.loadTrendingSection("anime").catch((error: Error) => error);
    discovery.clearTrendingCache();
    const b = discovery.loadTrendingSection("anime");
    newer.resolve([item("2", "Newer")]);
    expect((await b).results[0]?.title).toBe("Newer");
    older.resolve([item("1", "Older")]);
    // The cleared walk's caller is told it was cancelled, not handed its answer.
    expect(await a).toMatchObject({ name: "AbortError" });
    // The stale walk neither replaced memory nor the durable row.
    expect((await discovery.loadTrendingSection("anime")).results[0]?.title).toBe("Newer");
    expect(durable.read("catalog:trending:anime")?.results.map((entry) => entry.title)).toEqual([
      "Newer",
    ]);
  });

  test("an abandoned walk that settles late cannot overwrite its retry's answer", async () => {
    // Leaving /trending aborts the walk without a refresh, so the generation
    // does not move. A returning caller starts a fresh walk at once; the
    // abandoned one may still settle afterwards (Jikan handing back a partial
    // list after one id lookup was cancelled) and must write nothing.
    const durable = memoryDurable();
    const abandoned = Promise.withResolvers<readonly SearchResult[]>();
    const retry = Promise.withResolvers<readonly SearchResult[]>();
    let call = 0;
    const discovery = service(
      () => (call++ === 0 ? abandoned.promise : retry.promise),
      down,
      durable,
    );
    const leaving = new AbortController();
    const first = discovery.loadTrendingSection("anime", leaving.signal);
    leaving.abort();
    await expect(first).rejects.toThrow();

    const second = discovery.loadTrendingSection("anime");
    retry.resolve([item("2", "Newer")]);
    expect((await second).results[0]?.title).toBe("Newer");

    abandoned.resolve([item("1", "Older")]);
    await abandoned.promise;
    await Promise.resolve();
    await Promise.resolve();

    expect((await discovery.loadTrendingSection("anime")).results[0]?.title).toBe("Newer");
    expect(durable.read("catalog:trending:anime")?.results.map((entry) => entry.title)).toEqual([
      "Newer",
    ]);
  });

  test("an abandoned walk whose source answers empty does not move on to a fallback", async () => {
    const abandoned = Promise.withResolvers<readonly SearchResult[]>();
    let fallbackCalls = 0;
    const discovery = service(
      () => abandoned.promise,
      async () => {
        fallbackCalls += 1;
        return [item("9", "Fallback")];
      },
      memoryDurable(),
    );
    const leaving = new AbortController();
    const first = discovery.loadTrendingSection("anime", leaving.signal);
    leaving.abort();
    await expect(first).rejects.toThrow();
    abandoned.resolve([]);
    await abandoned.promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(fallbackCalls).toBe(0);
  });

  test("a slow live chain hands the caller the last good list, then fills the cache", async () => {
    const durable = memoryDurable();
    durable.write("catalog:trending:anime", NOW - 3_600_000, [item("1", "Old")]);
    const primary = Promise.withResolvers<readonly SearchResult[]>();
    const discovery = service(
      () => primary.promise,
      down,
      durable,
      () => NOW,
      0,
    );
    const hedged = await discovery.loadTrendingSection("anime");
    expect(hedged.sourceId).toBe("last-known-good");
    expect(hedged.staleSince).toBe(NOW - 3_600_000);

    primary.resolve([item("2", "Live")]);
    await primary.promise;
    await Promise.resolve();
    const next = await discovery.loadTrendingSection("anime");
    expect(next.sourceId).toBe("anilist");
    expect(next.results[0]?.title).toBe("Live");
  });
});

describe("contradictory anime mappings", () => {
  test("Kitsu: two AniList ids for one entry is ambiguous and dropped; duplicates collapse", async () => {
    const envelope = {
      data: [
        {
          id: "1",
          type: "anime",
          attributes: { canonicalTitle: "Ambiguous" },
          relationships: { mappings: { data: [{ id: "a" }, { id: "b" }] } },
        },
        {
          id: "2",
          type: "anime",
          attributes: { canonicalTitle: "Show" },
          relationships: { mappings: { data: [{ id: "c" }] } },
        },
        {
          id: "3",
          type: "anime",
          attributes: { canonicalTitle: "Show again" },
          relationships: { mappings: { data: [{ id: "d" }] } },
        },
      ],
      included: [
        {
          id: "a",
          type: "mappings",
          attributes: { externalSite: "anilist/anime", externalId: "10" },
        },
        {
          id: "b",
          type: "mappings",
          attributes: { externalSite: "anilist/anime", externalId: "11" },
        },
        {
          id: "c",
          type: "mappings",
          attributes: { externalSite: "anilist/anime", externalId: "20" },
        },
        {
          id: "d",
          type: "mappings",
          attributes: { externalSite: "anilist/anime", externalId: "20" },
        },
      ],
    };
    const fetchImpl = Object.assign(async () => Response.json(envelope), {
      preconnect: globalThis.fetch.preconnect,
    });
    const results = await loadKitsuAnimeTrending(undefined, fetchImpl);
    expect(results.map((r) => r.id)).toEqual(["20"]);
  });

  test("Jikan: an ARM answer for a different MAL id is rejected", async () => {
    const fetchImpl = Object.assign(
      async () =>
        Response.json({
          data: [
            { mal_id: 5, title: "A", type: "TV" },
            { mal_id: 6, title: "B", type: "TV" },
          ],
        }),
      { preconnect: globalThis.fetch.preconnect },
    );
    const results = await loadJikanAnimeTrending(undefined, {
      fetchImpl,
      lookupArm: async (malId) =>
        malId === "5" ? { anilistId: "50", malId: "999" } : { anilistId: "60", malId },
    });
    expect(results.map((r) => r.id)).toEqual(["60"]);
  });
});

describe("fallback quality and cost", () => {
  test("a recent saved AniList list beats a live Kitsu list", async () => {
    const durable = memoryDurable();
    durable.write(
      "catalog:trending:anime",
      NOW - 2 * 3_600_000,
      [item("1", "AniList pick")],
      "anilist",
    );
    let fallbackCalls = 0;
    const section = await service(
      down,
      async () => {
        fallbackCalls += 1;
        return [item("2", "Kitsu pick")];
      },
      durable,
    ).loadTrendingSection("anime");
    expect(section.sourceId).toBe("last-known-good");
    expect(section.results[0]?.title).toBe("AniList pick");
    expect(fallbackCalls).toBe(0);
  });

  test("an old saved list, or one from a fallback, does not block a live fallback", async () => {
    const durable = memoryDurable();
    durable.write("catalog:trending:anime", NOW - 3 * 86_400_000, [item("1", "Old")], "anilist");
    const section = await service(
      down,
      async () => [item("2", "Live fallback")],
      durable,
    ).loadTrendingSection("anime");
    expect(section.sourceId).toBe("jikan");
  });

  test("a failed fallback is skipped on the next outage instead of costing its timeout", async () => {
    let clock = NOW;
    let fallbackCalls = 0;
    const discovery = service(
      down,
      async () => {
        fallbackCalls += 1;
        throw new Error("blackholed");
      },
      memoryDurable(),
      () => clock,
    );
    await expect(discovery.loadTrendingSection("anime")).rejects.toThrow();
    discovery.clearTrendingCache();
    await expect(discovery.loadTrendingSection("anime")).rejects.toThrow();
    expect(fallbackCalls).toBe(1);
    // After the breaker window it is tried again.
    clock += 11 * 60_000;
    discovery.clearTrendingCache();
    await expect(discovery.loadTrendingSection("anime")).rejects.toThrow();
    expect(fallbackCalls).toBe(2);
  });

  test("a fallback answer is reused briefly, so the primary is retried soon", async () => {
    let clock = NOW;
    let primaryUp = false;
    const discovery = service(
      async () => {
        if (!primaryUp) throw new Error("down");
        return [item("1", "AniList")];
      },
      async () => [item("2", "Kitsu")],
      memoryDurable(),
      () => clock,
    );
    expect((await discovery.loadTrendingSection("anime")).sourceId).toBe("jikan");
    primaryUp = true;
    clock += 61_000;
    expect((await discovery.loadTrendingSection("anime")).sourceId).toBe("anilist");
  });

  test("seasons turn over on Japan time", () => {
    // 2026-09-30 16:00 UTC is already October 1 in Japan.
    expect(animeSeasonOf(new Date("2026-09-30T16:00:00Z")).season).toBe("fall");
    expect(animeSeasonOf(new Date("2026-09-30T14:00:00Z")).season).toBe("summer");
    expect(animeSeasonOf(new Date("2026-12-31T16:00:00Z"))).toEqual({
      season: "winter",
      year: 2027,
    });
  });
});
