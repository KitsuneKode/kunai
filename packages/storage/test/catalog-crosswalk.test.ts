import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CatalogCrosswalkRepository, openKunaiDatabase, runMigrations } from "../src/index";
import type { KunaiDatabase } from "../src/index";

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
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

  db.close();
});

test("CatalogCrosswalkRepository: expired rows are not returned", () => {
  const db = migratedCacheDb();
  const repo = new CatalogCrosswalkRepository(db);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  repo.put("tmdb", "13916", { tmdbId: "13916", confidence: "high", source: "arm" }, monthAgo);

  expect(repo.get("tmdb", "13916")).toBeUndefined();

  db.close();
});

test("CatalogCrosswalkRepository: caches definitive misses as empty graphs", () => {
  const db = migratedCacheDb();
  const repo = new CatalogCrosswalkRepository(db);

  repo.put("anilist", "999999", { confidence: "low", source: "arm" });

  const miss = repo.get("anilist", "999999");
  expect(miss).toBeDefined();
  expect(miss?.tmdbId).toBeUndefined();
  expect(miss?.confidence).toBe("low");

  db.close();
});

function migratedCacheDb(): KunaiDatabase {
  const dir = mkdtempSync(join(tmpdir(), "kunai-crosswalk-"));
  tempDirs.push(dir);
  const db = openKunaiDatabase(join(dir, "cache.sqlite"));
  runMigrations(db, "cache");
  return db;
}
