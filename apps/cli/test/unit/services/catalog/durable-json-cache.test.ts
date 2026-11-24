import { describe, expect, test } from "bun:test";

import type { SearchResult } from "@/domain/types";
import {
  createCatalogDurableCache,
  createDurableJsonCache,
  createTmdbDurableCache,
} from "@/services/catalog/durable-json-cache";
import { openKunaiDatabase, RecommendationCacheRepository, runMigrations } from "@kunai/storage";
import { isJsonNumber } from "@kunai/types";

const CACHED_AT = 1_800_000_000_000;

function repository() {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "cache");
  return new RecommendationCacheRepository(db);
}

/** Read a row as of when it was written, so retention never decides a test. */
function rowAt(repo: RecommendationCacheRepository, key: string) {
  return repo.get(key, new Date(CACHED_AT));
}

/** A repository view pinned to the write instant (rows expire relative to real time otherwise). */
function pinned(repo: RecommendationCacheRepository) {
  return {
    get: (key: string) => repo.get(key, new Date(CACHED_AT)),
    set: repo.set.bind(repo),
  };
}

const dune: SearchResult = {
  id: "438631",
  title: "Dune",
  type: "movie",
  year: "2021",
  overview: "",
  posterPath: null,
};

describe("createDurableJsonCache", () => {
  test("stores { cachedAt, ...fields } under the prefix with the retention window as expiry", () => {
    const repo = repository();
    const cache = createDurableJsonCache<{ readonly n: number }>(pinned(repo), {
      prefix: "test:",
      retentionMs: 60_000,
      parse: (record) => (isJsonNumber(record.n) ? { n: record.n } : null),
      encode: (value) => ({ n: value.n }),
    });
    cache.write("a", CACHED_AT, { n: 7 });
    const row = rowAt(repo, "test:a");
    expect(row?.payloadJson).toBe(JSON.stringify({ cachedAt: CACHED_AT, n: 7 }));
    expect(row?.expiresAt).toBe(new Date(CACHED_AT + 60_000).toISOString());
    expect(cache.read("a")).toEqual({ cachedAt: CACHED_AT, value: { n: 7 } });
  });

  test("a row that fails shape validation, lacks cachedAt, or is not JSON reads as no answer", () => {
    const repo = repository();
    const cache = createDurableJsonCache<{ readonly n: number }>(pinned(repo), {
      prefix: "",
      retentionMs: 60_000,
      parse: (record) => (isJsonNumber(record.n) ? { n: record.n } : null),
      encode: (value) => ({ n: value.n }),
    });
    const expires = new Date(CACHED_AT + 60_000).toISOString();
    repo.set("drifted", JSON.stringify({ cachedAt: CACHED_AT, n: "seven" }), expires);
    repo.set("undated", JSON.stringify({ n: 7 }), expires);
    repo.set("garbage", "{not json", expires);
    expect(cache.read("drifted")).toBeNull();
    expect(cache.read("undated")).toBeNull();
    expect(cache.read("garbage")).toBeNull();
    expect(cache.read("missing")).toBeNull();
  });

  test("never throws: a failing repository degrades to no saved answer", () => {
    const broken = {
      get: () => {
        throw new Error("database is locked");
      },
      set: () => {
        throw new Error("disk full");
      },
    };
    const cache = createDurableJsonCache<number>(broken, {
      prefix: "",
      retentionMs: 1,
      parse: () => 1,
      encode: (value) => ({ value }),
    });
    expect(cache.read("k")).toBeNull();
    expect(() => cache.write("k", CACHED_AT, 1)).not.toThrow();
  });

  test("encode returning null declines the write", () => {
    const repo = repository();
    const cache = createDurableJsonCache<number>(pinned(repo), {
      prefix: "",
      retentionMs: 60_000,
      parse: () => 1,
      encode: () => null,
    });
    cache.write("k", CACHED_AT, 1);
    expect(rowAt(repo, "k")).toBeUndefined();
  });
});

describe("the two durable caches keep their row formats", () => {
  test("catalog rows are { cachedAt, results, sourceId? } under the caller's key", () => {
    const repo = repository();
    const cache = createCatalogDurableCache(pinned(repo), 60_000);
    cache.write("catalog:trending:series", CACHED_AT, [dune], "tmdb");
    cache.write("catalog:trending:anime", CACHED_AT, [dune]);
    expect(rowAt(repo, "catalog:trending:series")?.payloadJson).toBe(
      JSON.stringify({ cachedAt: CACHED_AT, results: [dune], sourceId: "tmdb" }),
    );
    expect(rowAt(repo, "catalog:trending:anime")?.payloadJson).toBe(
      JSON.stringify({ cachedAt: CACHED_AT, results: [dune] }),
    );
    expect(cache.read("catalog:trending:series")).toEqual({
      cachedAt: CACHED_AT,
      results: [dune],
      sourceId: "tmdb",
    });
    expect(cache.read("catalog:trending:anime")).toEqual({ cachedAt: CACHED_AT, results: [dune] });
  });

  test("tmdb rows are { cachedAt, value } under tmdb:<path>, and only an object is kept or served", () => {
    const repo = repository();
    const cache = createTmdbDurableCache(pinned(repo), 60_000);
    cache.write("/tv/2316", CACHED_AT, { id: 2316, seasons: [] });
    expect(rowAt(repo, "tmdb:/tv/2316")?.payloadJson).toBe(
      JSON.stringify({ cachedAt: CACHED_AT, value: { id: 2316, seasons: [] } }),
    );
    expect(cache.read("/tv/2316")).toEqual({
      cachedAt: CACHED_AT,
      value: { id: 2316, seasons: [] },
    });

    cache.write("/tv/1", CACHED_AT, [1, 2]);
    expect(rowAt(repo, "tmdb:/tv/1")).toBeUndefined();
    repo.set(
      "tmdb:/tv/2",
      JSON.stringify({ cachedAt: CACHED_AT, value: "not a show" }),
      new Date(CACHED_AT + 60_000).toISOString(),
    );
    expect(cache.read("/tv/2")).toBeNull();
  });
});
