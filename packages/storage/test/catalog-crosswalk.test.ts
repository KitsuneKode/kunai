import { afterAll, expect, test } from "bun:test";

import { CatalogCrosswalkRepository, openKunaiDatabase, runMigrations } from "../src/index";
import type { KunaiDatabase } from "../src/index";
import { createTempStoreRegistry } from "./helpers/temp-store";

const stores = createTempStoreRegistry();

afterAll(() => {
  stores.cleanup();
});

test("CatalogCrosswalkRepository: round-trips a graph by source id", () => {
  const db = migratedCacheDb();
  const repo = new CatalogCrosswalkRepository(db);

  repo.put("anilist", "1535", {
    anilistId: "1535",
    malId: "1535",
    tmdbId: "13916",
    imdbId: "tt0877057",
    tmdbSeason: 1,
    confidence: "high",
    source: "arm",
  });

  const hit = repo.get("anilist", "1535");
  expect(hit?.tmdbId).toBe("13916");
  expect(hit?.confidence).toBe("high");
  expect(repo.get("anilist", "404404")).toBeUndefined();
});

test("CatalogCrosswalkRepository: expired rows are not returned", () => {
  const db = migratedCacheDb();
  const repo = new CatalogCrosswalkRepository(db);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  repo.put("tmdb", "13916", { tmdbId: "13916", confidence: "high", source: "arm" }, monthAgo);

  expect(repo.get("tmdb", "13916")).toBeUndefined();
});

test("CatalogCrosswalkRepository: caches definitive misses as empty graphs", () => {
  const db = migratedCacheDb();
  const repo = new CatalogCrosswalkRepository(db);

  repo.put("anilist", "999999", { confidence: "low", source: "arm" });

  const miss = repo.get("anilist", "999999");
  expect(miss).toBeDefined();
  expect(miss?.tmdbId).toBeUndefined();
  expect(miss?.confidence).toBe("low");
});

function migratedCacheDb(): KunaiDatabase {
  const db = stores.store("crosswalk", "cache");
  return db;
}
