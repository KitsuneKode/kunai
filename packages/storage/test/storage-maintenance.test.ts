import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  openKunaiDatabase,
  runDatabaseMaintenance,
  runMigrations,
  type KunaiDatabase,
} from "../src/index";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cache maintenance prunes disposable expired rows without touching durable data tables", () => {
  const dataDb = migratedDb("data");
  const cacheDb = migratedDb("cache");
  seedDurableData(dataDb);
  seedCacheData(cacheDb);

  const result = runDatabaseMaintenance(cacheDb, {
    database: "cache",
    now: new Date("2026-05-17T00:00:00.000Z"),
    maxResolveTraces: 2,
    providerHealthRetentionDays: 30,
  });
  runDatabaseMaintenance(dataDb, {
    database: "data",
    now: new Date("2026-05-17T00:00:00.000Z"),
  });

  expect(result.pruned).toEqual({
    streamCache: 1,
    sourceInventory: 1,
    recommendationCache: 1,
    scheduleCache: 1,
    resolveTraces: 1,
    providerHealth: 1,
    titleProviderHealth: 0,
    releaseProgress: 0,
  });
  expect(count(dataDb, "history_progress")).toBe(2);
  expect(count(dataDb, "list_items")).toBe(1);
  expect(count(dataDb, "download_jobs")).toBe(1);
  expect(count(cacheDb, "stream_cache")).toBe(1);
  expect(count(cacheDb, "source_inventory")).toBe(1);
  expect(count(cacheDb, "recommendation_cache")).toBe(1);
  expect(count(cacheDb, "schedule_cache")).toBe(1);
  expect(count(cacheDb, "resolve_traces")).toBe(2);
  expect(count(cacheDb, "provider_health")).toBe(1);

  dataDb.close();
  cacheDb.close();
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kunai-storage-maintenance-"));
  tempDirs.push(dir);
  return dir;
}

function migratedDb(database: "data" | "cache"): KunaiDatabase {
  const db = openKunaiDatabase(join(makeTempDir(), `${database}.sqlite`));
  runMigrations(db, database);
  return db;
}

function seedDurableData(db: KunaiDatabase): void {
  db.query(
    `
      INSERT INTO history_progress (
        key, title_id, media_kind, title, season, episode, position_seconds,
        duration_seconds, completed, provider_id, updated_at, created_at
      )
      VALUES ('series:tmdb:1:1:1', 'tmdb:1', 'series', 'Example', 1, 1, 120, 1200, 0, 'vidking', ?, ?)
    `,
  ).run("2026-05-16T00:00:00.000Z", "2026-05-16T00:00:00.000Z");
  db.query(
    `
      INSERT INTO history_progress (
        key, title_id, media_kind, title, season, episode, position_seconds,
        duration_seconds, completed, provider_id, updated_at, created_at
      )
      VALUES ('series:tmdb:old:1:1', 'tmdb:old', 'series', 'Old But Durable', 1, 1, 1200, 1200, 1, 'vidking', ?, ?)
    `,
  ).run("2025-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z");
  db.query(
    `
      INSERT INTO list_items (
        id, list_id, title_id, media_kind, title, season, episode, added_at, sort_order
      )
      VALUES ('item-1', 'watchlist', 'tmdb:1', 'series', 'Example', 1, 1, ?, 0)
    `,
  ).run("2026-05-16T00:00:00.000Z");
  db.query(
    `
      INSERT INTO download_jobs (
        id, title_id, title_name, media_kind, season, episode, provider_id,
        stream_url, headers_json, status, progress_percent, output_path, temp_path,
        retry_count, created_at, updated_at, completed_at
      )
      VALUES (
        'job-1', 'tmdb:1', 'Example', 'series', 1, 1, 'vidking',
        'https://cdn.example/stream.m3u8', '{}', 'completed', 100,
        '/tmp/example.mp4', '/tmp/example.tmp', 0, ?, ?, ?
      )
    `,
  ).run("2026-05-16T00:00:00.000Z", "2026-05-16T00:00:00.000Z", "2026-05-16T00:10:00.000Z");
}

function seedCacheData(db: KunaiDatabase): void {
  db.query(
    `
      INSERT INTO stream_cache (
        cache_key, schema_version, provider_id, stream_json,
        expires_at, created_at, last_accessed_at, hit_count
      )
      VALUES (?, 1, 'vidking', '{}', ?, ?, ?, 0)
    `,
  ).run(
    "expired-stream",
    "2026-05-16T00:00:00.000Z",
    "2026-05-15T00:00:00.000Z",
    "2026-05-15T00:00:00.000Z",
  );
  db.query(
    `
      INSERT INTO stream_cache (
        cache_key, schema_version, provider_id, stream_json,
        expires_at, created_at, last_accessed_at, hit_count
      )
      VALUES (?, 1, 'vidking', '{}', ?, ?, ?, 0)
    `,
  ).run(
    "fresh-stream",
    "2026-05-18T00:00:00.000Z",
    "2026-05-17T00:00:00.000Z",
    "2026-05-17T00:00:00.000Z",
  );

  for (const table of ["source_inventory", "recommendation_cache", "schedule_cache"] as const) {
    seedExpiringCacheTable(db, table, "expired", "2026-05-16T00:00:00.000Z");
    seedExpiringCacheTable(db, table, "fresh", "2026-05-18T00:00:00.000Z");
  }

  for (let index = 1; index <= 3; index += 1) {
    db.query(
      `
        INSERT INTO resolve_traces (trace_id, trace_json, started_at, created_at)
        VALUES (?, '{}', ?, ?)
      `,
    ).run(`trace-${index}`, `2026-05-17T00:0${index}:00.000Z`, `2026-05-17T00:0${index}:00.000Z`);
  }

  db.query(
    "INSERT INTO provider_health (provider_id, health_json, checked_at) VALUES (?, '{}', ?)",
  ).run("stale", "2026-04-01T00:00:00.000Z");
  db.query(
    "INSERT INTO provider_health (provider_id, health_json, checked_at) VALUES (?, '{}', ?)",
  ).run("fresh", "2026-05-16T00:00:00.000Z");
}

function seedExpiringCacheTable(
  db: KunaiDatabase,
  table: "source_inventory" | "recommendation_cache" | "schedule_cache",
  suffix: string,
  expiresAt: string,
): void {
  if (table === "source_inventory") {
    db.query(
      `
        INSERT INTO source_inventory (
          inventory_key, provider_id, title_id, inventory_json,
          expires_at, created_at, last_accessed_at
        )
        VALUES (?, 'vidking', 'tmdb:1', '{}', ?, ?, ?)
      `,
    ).run(`inventory-${suffix}`, expiresAt, "2026-05-15T00:00:00.000Z", "2026-05-15T00:00:00.000Z");
    return;
  }

  const keyColumn = table === "recommendation_cache" ? "cache_key" : "cache_key";
  const payloadColumn = table === "recommendation_cache" ? "payload_json" : "payload_json";
  db.query(
    `
      INSERT INTO ${table} (
        ${keyColumn}, ${payloadColumn}, expires_at, created_at, last_accessed_at, hit_count
      )
      VALUES (?, '{}', ?, ?, ?, 0)
    `,
  ).run(`${table}-${suffix}`, expiresAt, "2026-05-15T00:00:00.000Z", "2026-05-15T00:00:00.000Z");
}

function count(db: KunaiDatabase, table: string): number {
  return (
    db.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count ?? 0
  );
}
