import { expect, test } from "bun:test";

import type { ArmIdGraph } from "@/services/catalog/arm-client";
import { CatalogIdentityService } from "@/services/catalog/CatalogIdentityService";
import type { CatalogIdGraph } from "@kunai/types";

function fakeArm(responses: Record<string, ArmIdGraph | null | undefined>, calls: string[] = []) {
  return {
    calls,
    fetchIds: async (source: string, id: string) => {
      calls.push(`${source}:${id}`);
      return responses[`${source}:${id}`];
    },
  };
}

function memoryCache() {
  const store = new Map<string, CatalogIdGraph>();
  return {
    store,
    get: (ns: string, id: string) => store.get(`${ns}:${id}`),
    put: (ns: string, id: string, graph: CatalogIdGraph) => {
      store.set(`${ns}:${id}`, graph);
    },
  };
}

const deathNoteArm: ArmIdGraph = {
  anilistId: "1535",
  malId: "1535",
  tmdbId: "13916",
  imdbId: "tt0877057",
  tmdbSeason: 1,
};

test("enrich attaches TMDB/IMDB ids to an AniList-only anime via ARM", async () => {
  const arm = fakeArm({ "anilist:1535": deathNoteArm });
  const cache = memoryCache();
  const service = new CatalogIdentityService({ arm, cache });

  const result = await service.enrich({
    id: "1535",
    kind: "anime",
    title: "Death Note",
    externalIds: { anilistId: "1535" },
  });

  expect(result.externalIds?.tmdbId).toBe("13916");
  expect(result.externalIds?.imdbId).toBe("tt0877057");
  expect(result.externalIds?.malId).toBe("1535");
  expect(result.graph.confidence).toBe("high");
  expect(result.graph.source).toBe("arm");
  expect(result.graph.tmdbSeason).toBe(1);
});

test("enrich never clobbers existing external ids", async () => {
  const arm = fakeArm({
    "anilist:1535": { ...deathNoteArm, imdbId: "tt9999999" },
  });
  const service = new CatalogIdentityService({ arm, cache: memoryCache() });

  const result = await service.enrich({
    id: "1535",
    kind: "anime",
    title: "Death Note",
    externalIds: { anilistId: "1535", imdbId: "tt0000001" },
  });

  expect(result.externalIds?.imdbId).toBe("tt0000001");
  expect(result.externalIds?.tmdbId).toBe("13916");
});

test("enrich skips the network when both lane ids are already present", async () => {
  const arm = fakeArm({});
  const service = new CatalogIdentityService({ arm, cache: memoryCache() });

  const result = await service.enrich({
    id: "1535",
    kind: "anime",
    title: "Death Note",
    externalIds: { anilistId: "1535", tmdbId: "13916" },
  });

  expect(arm.calls).toEqual([]);
  expect(result.graph.source).toBe("passthrough");
  expect(result.graph.confidence).toBe("high");
});

test("enrich uses the crosswalk cache before calling ARM", async () => {
  const arm = fakeArm({ "anilist:1535": deathNoteArm });
  const cache = memoryCache();
  const service = new CatalogIdentityService({ arm, cache });

  await service.enrich({
    id: "1535",
    kind: "anime",
    title: "Death Note",
    externalIds: { anilistId: "1535" },
  });
  await service.enrich({
    id: "1535",
    kind: "anime",
    title: "Death Note",
    externalIds: { anilistId: "1535" },
  });

  expect(arm.calls).toEqual(["anilist:1535"]);
});

test("enrich caches definitive ARM misses and stays low confidence", async () => {
  const arm = fakeArm({ "anilist:404": null });
  const cache = memoryCache();
  const service = new CatalogIdentityService({ arm, cache });

  const result = await service.enrich({
    id: "404",
    kind: "anime",
    title: "Obscure Show",
    externalIds: { anilistId: "404" },
  });

  expect(result.externalIds?.tmdbId).toBeUndefined();
  expect(result.graph.confidence).toBe("low");
  expect(cache.store.has("anilist:404")).toBe(true);

  await service.enrich({
    id: "404",
    kind: "anime",
    title: "Obscure Show",
    externalIds: { anilistId: "404" },
  });
  expect(arm.calls).toEqual(["anilist:404"]);
});

test("enrich degrades to passthrough on network failure without caching", async () => {
  const arm = fakeArm({ "anilist:1535": undefined });
  const cache = memoryCache();
  const service = new CatalogIdentityService({ arm, cache });

  const result = await service.enrich({
    id: "1535",
    kind: "anime",
    title: "Death Note",
    externalIds: { anilistId: "1535" },
  });

  expect(result.externalIds?.anilistId).toBe("1535");
  expect(result.graph.source).toBe("passthrough");
  expect(cache.store.size).toBe(0);
});

test("enrich maps a TMDB series to AniList ids through the tmdb source", async () => {
  const arm = fakeArm({ "themoviedb:13916": deathNoteArm });
  const service = new CatalogIdentityService({ arm, cache: memoryCache() });

  const result = await service.enrich({
    id: "tmdb:13916",
    kind: "series",
    title: "Death Note",
    externalIds: { tmdbId: "13916" },
  });

  expect(result.externalIds?.anilistId).toBe("1535");
  expect(result.graph.confidence).toBe("high");
});

test("enrich infers the anilist source from a bare numeric anime id", async () => {
  const arm = fakeArm({ "anilist:20431": { anilistId: "20431", malId: "20431" } });
  const service = new CatalogIdentityService({ arm, cache: memoryCache() });

  const result = await service.enrich({
    id: "20431",
    kind: "anime",
    title: "Hozuki's Coolheadedness",
  });

  expect(result.externalIds?.malId).toBe("20431");
});

test("enrich leaves opaque provider-native ids alone (no guessing)", async () => {
  const arm = fakeArm({});
  const service = new CatalogIdentityService({ arm, cache: memoryCache() });

  const result = await service.enrich({
    id: "bxCKTnota29uSRnZw",
    kind: "anime",
    title: "Unknown",
  });

  expect(arm.calls).toEqual([]);
  expect(result.graph.confidence).toBe("low");
  expect(result.graph.source).toBe("passthrough");
});
