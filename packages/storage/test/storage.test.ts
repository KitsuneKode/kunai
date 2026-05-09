import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { StreamCandidate } from "@kunai/types";

import {
  createStreamCacheKey,
  DownloadJobsRepository,
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
  expect(linux.mpvBridgePath).toBe("/xdg/config/kunai/mpv/kunai-bridge.lua");
  expect(mac.configPath).toBe("/Users/k/Library/Application Support/kunai/config.json");
  expect(mac.cacheDbPath).toBe("/Users/k/Library/Caches/kunai/kunai-cache.sqlite");
  expect(mac.mpvBridgePath).toBe("/Users/k/Library/Application Support/kunai/mpv/kunai-bridge.lua");
  expect(win.configPath).toContain("C:\\Roaming");
  expect(win.dataDbPath).toContain("kunai-data.sqlite");
  expect(win.mpvBridgePath).toContain("kunai-bridge.lua");
  expect(win.mpvBridgePath.toLowerCase()).toContain("roaming");
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
  expect(dataTables).toContain("download_jobs");
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
    resolverRuntime: "direct-http",
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

test("download jobs repository supports queue lifecycle", () => {
  const db = migratedDataDb();
  const repo = new DownloadJobsRepository(db);
  const now = "2026-04-29T00:00:00.000Z";

  repo.enqueue({
    id: "job-1",
    titleId: "tmdb:1",
    titleName: "Example",
    mediaKind: "series",
    season: 1,
    episode: 1,
    providerId: "vidking",
    mode: "series",
    subLang: "eng",
    animeLang: "sub",
    selectedSourceId: "source-1",
    selectedStreamId: "stream-1080p",
    selectedQualityLabel: "1080p",
    streamUrl: "https://example.com/master.m3u8",
    headers: { Referer: "https://example.com" },
    outputPath: "/tmp/example.mp4",
    tempPath: "/tmp/example.mp4.tmp.job-1",
    createdAt: now,
    updatedAt: now,
    completedAt: undefined,
  });
  expect(repo.listQueued(10)).toHaveLength(1);

  repo.markRunning("job-1", "2026-04-29T00:01:00.000Z");
  repo.updateProgress("job-1", 42, "2026-04-29T00:02:00.000Z");
  expect(repo.get("job-1")?.progressPercent).toBe(42);
  expect(repo.get("job-1")?.attempt).toBe(1);

  repo.scheduleRetry(
    "job-1",
    "temporary network issue",
    "2026-04-29T00:02:30.000Z",
    "2026-04-29T00:02:10.000Z",
  );
  expect(repo.get("job-1")?.status).toBe("queued");
  expect(repo.get("job-1")?.retryCount).toBe(1);
  expect(repo.get("job-1")?.nextRetryAt).toBe("2026-04-29T00:02:30.000Z");

  repo.markRunning("job-1", "2026-04-29T00:02:40.000Z");
  repo.fail("job-1", "fatal", true, "2026-04-29T00:02:45.000Z", "http-client");
  expect(repo.listFailed(10)).toHaveLength(1);

  repo.requeue("job-1", "2026-04-29T00:02:50.000Z");
  expect(repo.get("job-1")?.status).toBe("queued");
  repo.complete("job-1", "2026-04-29T00:03:00.000Z");
  const done = repo.listCompleted(10)[0];
  expect(done?.status).toBe("completed");
  expect(done?.completedAt).toBe("2026-04-29T00:03:00.000Z");
  expect(done?.mode).toBe("series");
  expect(done?.subLang).toBe("eng");
  expect(done?.selectedStreamId).toBe("stream-1080p");
  expect(done?.artifactStatus).toBe("ready");

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
