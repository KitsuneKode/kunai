import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test } from "bun:test";

import type { StreamCandidate } from "@kunai/types";

import {
  createStreamCacheKey,
  getDefaultTtlMs,
  getExpiresAt,
  getKunaiPaths,
  HistoryRepository,
  openKunaiDatabase,
  ProviderHealthRepository,
  ResolveTraceRepository,
  runMigrations,
  SourceInventoryRepository,
  StreamCacheRepository,
} from "../src/index";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("path resolver is deterministic across supported platforms", () => {
  const linux = getKunaiPaths({
    platform: "linux",
    homeDir: "/home/k",
    env: {
      XDG_CONFIG_HOME: "/xdg/config",
      XDG_DATA_HOME: "/xdg/data",
      XDG_CACHE_HOME: "/xdg/cache",
      TMPDIR: "/tmp",
    },
  });
  const mac = getKunaiPaths({
    platform: "darwin",
    homeDir: "/Users/k",
    env: { TMPDIR: "/var/tmp" },
  });
  const win = getKunaiPaths({
    platform: "win32",
    homeDir: "C:\\Users\\k",
    env: { APPDATA: "C:\\Roaming", LOCALAPPDATA: "C:\\Local", TEMP: "C:\\Temp" },
  });

  expect(linux.dataDbPath).toBe("/xdg/data/kunai/kunai-data.sqlite");
  expect(linux.cacheDbPath).toBe("/xdg/cache/kunai/kunai-cache.sqlite");
  expect(mac.configPath).toBe("/Users/k/Library/Application Support/kunai/config.json");
  expect(mac.cacheDbPath).toBe("/Users/k/Library/Caches/kunai/kunai-cache.sqlite");
  expect(win.configPath).toContain("C:\\Roaming");
  expect(win.dataDbPath).toContain("kunai-data.sqlite");
});

test("migrations are idempotent and create expected storage tables", () => {
  const dir = makeTempDir();
  const dataDb = openKunaiDatabase(join(dir, "data.sqlite"));
  const cacheDb = openKunaiDatabase(join(dir, "cache.sqlite"));

  runMigrations(dataDb, "data");
  runMigrations(dataDb, "data");
  runMigrations(cacheDb, "cache");
  runMigrations(cacheDb, "cache");

  const dataTables = tableNames(dataDb);
  const cacheTables = tableNames(cacheDb);

  expect(dataTables).toContain("history_progress");
  expect(dataTables).toContain("playback_events");
  expect(cacheTables).toContain("stream_cache");
  expect(cacheTables).toContain("provider_health");
  expect(cacheTables).toContain("source_inventory");
  expect(cacheTables).toContain("resolve_traces");

  dataDb.close();
  cacheDb.close();
});

test("ttl and stream cache key helpers encode compatibility inputs", () => {
  const key = createStreamCacheKey({
    providerId: "VidKing",
    providerVersion: "1",
    title: { id: "tmdb:1", kind: "movie" },
    audioLanguage: "Japanese",
    subtitleLanguage: "English",
    qualityPreference: "1080p",
    resolverRuntime: "node-fetch",
  });

  expect(key).toContain("vidking");
  expect(key).toContain("japanese");
  expect(key).toContain("english");
  expect(getDefaultTtlMs("stream-manifest")).toBeGreaterThan(0);
  expect(Date.parse(getExpiresAt("stream-manifest"))).toBeGreaterThan(Date.now());
});

test("history repository round trips latest progress", () => {
  const db = migratedDataDb();
  const repo = new HistoryRepository(db);

  repo.upsertProgress({
    title: { id: "tmdb:1", kind: "series", title: "Example" },
    episode: { season: 1, episode: 2 },
    positionSeconds: 42.8,
    durationSeconds: 1200,
    completed: false,
    providerId: "vidking",
    updatedAt: "2026-04-29T00:00:00.000Z",
  });

  const progress = repo.getProgress(
    { id: "tmdb:1", kind: "series", title: "Example" },
    { season: 1, episode: 2 },
  );

  expect(progress?.positionSeconds).toBe(42);
  expect(progress?.providerId).toBe("vidking");
  expect(repo.listRecent(1)[0]?.key).toContain("tmdb:1");
  expect(repo.listByTitle("tmdb:1")).toHaveLength(1);

  db.close();
});

test("stream cache repository returns hits and prunes expired entries", () => {
  const db = migratedCacheDb();
  const repo = new StreamCacheRepository(db);
  const stream = makeStreamCandidate();

  repo.set("stream:key", stream, "2026-04-29T00:05:00.000Z", "2026-04-29T00:00:00.000Z");

  const hit = repo.get("stream:key", new Date("2026-04-29T00:01:00.000Z"));
  expect(hit?.hitCount).toBe(1);
  expect(hit?.stream.protocol).toBe("hls");

  const expired = repo.get("stream:key", new Date("2026-04-29T00:06:00.000Z"));
  expect(expired).toBeUndefined();

  db.close();
});

test("provider health, inventory, and trace repositories round trip typed data", () => {
  const db = migratedCacheDb();

  const healthRepo = new ProviderHealthRepository(db);
  healthRepo.set({
    providerId: "vidking",
    status: "healthy",
    checkedAt: "2026-04-29T00:00:00.000Z",
    recentFailureRate: 0.1,
  });
  expect(healthRepo.get("vidking")?.status).toBe("healthy");

  const inventoryRepo = new SourceInventoryRepository(db);
  inventoryRepo.set(
    "inventory:key",
    "vidking",
    "tmdb:1",
    { sources: 2 },
    "2026-04-29T01:00:00.000Z",
  );
  expect(
    inventoryRepo.get<{ sources: number }>("inventory:key", new Date("2026-04-29T00:30:00.000Z"))
      ?.inventory.sources,
  ).toBe(2);

  const traceRepo = new ResolveTraceRepository(db);
  traceRepo.add({
    id: "trace-1",
    startedAt: "2026-04-29T00:00:00.000Z",
    title: { id: "tmdb:1", kind: "movie", title: "Example" },
    cacheHit: false,
    steps: [],
    failures: [],
  });
  expect(traceRepo.get("trace-1")?.title.title).toBe("Example");
  expect(traceRepo.listRecent(1)).toHaveLength(1);

  db.close();
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kunai-storage-"));
  tempDirs.push(dir);
  return dir;
}

function migratedDataDb() {
  const db = openKunaiDatabase(join(makeTempDir(), "data.sqlite"));
  runMigrations(db, "data");
  return db;
}

function migratedCacheDb() {
  const db = openKunaiDatabase(join(makeTempDir(), "cache.sqlite"));
  runMigrations(db, "cache");
  return db;
}

function tableNames(db: ReturnType<typeof openKunaiDatabase>): string[] {
  return db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .all()
    .map((row) => row.name);
}

function makeStreamCandidate(): StreamCandidate {
  return {
    id: "stream-1",
    providerId: "vidking",
    url: "https://example.com/master.m3u8",
    protocol: "hls",
    container: "m3u8",
    confidence: 0.9,
    cachePolicy: {
      ttlClass: "stream-manifest",
      scope: "local",
      keyParts: ["vidking", "tmdb:1"],
    },
  };
}
