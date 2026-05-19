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
  ListRepository,
  openKunaiDatabase,
  PlaylistRepository,
  ProviderHealthRepository,
  ResolveTraceRepository,
  runMigrations,
  ScheduleCacheRepository,
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
  expect(cacheTables).toContain("schedule_cache");

  dataDb.close();
  cacheDb.close();
});

test("schedule cache repository stores and expires catalog payloads by cache key", () => {
  const db = migratedCacheDb();
  const repo = new ScheduleCacheRepository(db);

  repo.set("today:anime:2026-05-15", JSON.stringify([{ titleId: "21" }]), {
    expiresAt: "2026-05-15T13:00:00.000Z",
    now: "2026-05-15T12:00:00.000Z",
    source: "anilist",
    mode: "anime",
  });

  expect(
    repo.get("today:anime:2026-05-15", new Date("2026-05-15T12:30:00.000Z"))?.payloadJson,
  ).toBe(JSON.stringify([{ titleId: "21" }]));
  expect(repo.get("today:anime:2026-05-15", new Date("2026-05-15T14:00:00.000Z"))).toBe(undefined);

  db.close();
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
  expect(getDefaultTtlMs("direct-media-url")).toBeLessThan(getDefaultTtlMs("provider-metadata"));
  expect(getDefaultTtlMs("stream-manifest")).toBeLessThan(getDefaultTtlMs("provider-metadata"));
  expect(getDefaultTtlMs("provider-metadata")).toBeLessThan(getDefaultTtlMs("catalog-static"));
});

test("history repository round trips latest progress", () => {
  const db = migratedDataDb();
  const repo = new HistoryRepository(db);

  repo.upsertProgress({
    title: {
      id: "tmdb:1",
      kind: "series",
      title: "Example",
      externalIds: { tmdbId: "1", imdbId: "tt123", anilistId: "987", malId: "654" },
    },
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
  expect(progress?.externalIds).toEqual({
    tmdbId: "1",
    imdbId: "tt123",
    anilistId: "987",
    malId: "654",
  });
  expect(repo.listRecent(1)[0]?.key).toContain("tmdb:1");
  expect(repo.listByTitle("tmdb:1")).toHaveLength(1);

  db.close();
});

test("history repository keeps legacy progress without external ids compatible", () => {
  const db = migratedDataDb();
  const repo = new HistoryRepository(db);

  repo.upsertProgress({
    title: { id: "tmdb:legacy", kind: "series", title: "Legacy Example" },
    episode: { season: 1, episode: 1 },
    positionSeconds: 12,
    durationSeconds: 1200,
    completed: false,
    providerId: "vidking",
    updatedAt: "2026-04-29T00:00:00.000Z",
  });

  const progress = repo.getProgress(
    { id: "tmdb:legacy", kind: "series", title: "Legacy Example" },
    { season: 1, episode: 1 },
  );

  expect(progress?.externalIds).toBeUndefined();
  expect(progress?.positionSeconds).toBe(12);

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
    posterUrl: "https://img.example/poster.jpg",
    createdAt: now,
    updatedAt: now,
    completedAt: undefined,
  });
  expect(repo.listQueued(10)).toHaveLength(1);
  repo.updateOfflineMetadata(
    "job-1",
    {
      introSkipJson: JSON.stringify({ openings: [] }),
      thumbnailPath: "/tmp/example.thumbnail.jpg",
    },
    "2026-04-29T00:00:30.000Z",
  );

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
  expect(done?.posterUrl).toBe("https://img.example/poster.jpg");
  expect(done?.thumbnailPath).toBe("/tmp/example.thumbnail.jpg");
  expect(done?.introSkipJson).toBe(JSON.stringify({ openings: [] }));

  db.close();
});

test("download jobs repository preserves repairable sidecar status without losing completed video", () => {
  const db = migratedDataDb();
  const repo = new DownloadJobsRepository(db);
  const now = "2026-04-29T00:00:00.000Z";

  repo.enqueue({
    id: "job-sidecar",
    titleId: "tmdb:sidecar",
    titleName: "Sidecar Example",
    mediaKind: "series",
    season: 1,
    episode: 2,
    providerId: "vidking",
    streamUrl: "https://example.com/master.m3u8",
    headers: {},
    outputPath: "/tmp/sidecar.mp4",
    tempPath: "/tmp/sidecar.mp4.tmp.job-sidecar",
    createdAt: now,
    updatedAt: now,
    completedAt: undefined,
  });

  repo.markRepairable(
    "job-sidecar",
    {
      artifactStatus: "expected-missing",
      message: "Subtitle sidecar was expected but missing",
      repairMetadataJson: JSON.stringify({
        sidecar: "subtitle",
        action: "retry-sidecar",
      }),
    },
    "2026-04-29T00:03:00.000Z",
  );

  const repairable = repo.get("job-sidecar");
  expect(repairable?.status).toBe("repairable");
  expect(repairable?.artifactStatus).toBe("expected-missing");
  expect(repairable?.repairMetadataJson).toContain("retry-sidecar");
  expect(repo.listFailed(10).map((job) => job.id)).toContain("job-sidecar");

  repo.completeWithNotes(
    "job-sidecar",
    {
      artifactStatus: "optional-missing",
      message: "Artwork could not be cached",
      repairMetadataJson: null,
    },
    "2026-04-29T00:04:00.000Z",
  );

  const completedWithNotes = repo.get("job-sidecar");
  expect(completedWithNotes?.status).toBe("completed-with-notes");
  expect(completedWithNotes?.artifactStatus).toBe("optional-missing");
  expect(completedWithNotes?.repairMetadataJson).toBeUndefined();
  expect(repo.listCompleted(10).map((job) => job.id)).toContain("job-sidecar");

  db.close();
});

test("download jobs repository keeps legacy artifact rows compatible with repair metadata", () => {
  const db = migratedDataDb();
  const repo = new DownloadJobsRepository(db);
  const now = "2026-04-29T00:00:00.000Z";

  repo.enqueue({
    id: "job-legacy",
    titleId: "tmdb:legacy-download",
    titleName: "Legacy Download",
    mediaKind: "movie",
    providerId: "vidking",
    streamUrl: "https://example.com/movie.m3u8",
    headers: {},
    outputPath: "/tmp/legacy.mp4",
    tempPath: "/tmp/legacy.mp4.tmp.job-legacy",
    createdAt: now,
    updatedAt: now,
    completedAt: undefined,
  });

  const legacy = repo.get("job-legacy");
  expect(legacy?.artifactStatus).toBe("pending");
  expect(legacy?.repairMetadataJson).toBeUndefined();

  repo.markArtifactValidated("job-legacy", "not-applicable", "2026-04-29T00:01:00.000Z");
  expect(repo.get("job-legacy")?.artifactStatus).toBe("not-applicable");

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

// ─── ListRepository ───────────────────────────────────────────────────────────

test("ListRepository: migration seeds default watchlist and favorites", () => {
  const db = migratedDataDb();
  const repo = new ListRepository(db);

  const lists = repo.getLists();
  expect(lists.length).toBeGreaterThanOrEqual(2);
  expect(lists.some((l) => l.id === "watchlist" && l.kind === "watchlist")).toBe(true);
  expect(lists.some((l) => l.id === "favorites" && l.kind === "favorites")).toBe(true);

  db.close();
});

test("ListRepository: createList + getList roundtrip", () => {
  const db = migratedDataDb();
  const repo = new ListRepository(db);

  const list = repo.createList({ name: "Action", kind: "custom", color: "#ff0000" });
  expect(list.name).toBe("Action");
  expect(list.kind).toBe("custom");
  expect(list.color).toBe("#ff0000");

  const found = repo.getList(list.id);
  expect(found?.id).toBe(list.id);

  db.close();
});

test("ListRepository: addItem + getItems + removeItem", () => {
  const db = migratedDataDb();
  const repo = new ListRepository(db);

  const item = repo.addItem({
    listId: "watchlist",
    titleId: "tmdb:123",
    mediaKind: "series",
    title: "Frieren",
  });
  expect(item.titleId).toBe("tmdb:123");
  expect(item.title).toBe("Frieren");

  const items = repo.getItems("watchlist");
  expect(items.some((i) => i.id === item.id)).toBe(true);

  repo.removeItem(item.id);
  const after = repo.getItems("watchlist");
  expect(after.some((i) => i.id === item.id)).toBe(false);

  db.close();
});

test("ListRepository: toggleItem adds then removes on second call", () => {
  const db = migratedDataDb();
  const repo = new ListRepository(db);

  const input = { listId: "watchlist", titleId: "tmdb:42", mediaKind: "anime", title: "AoT" };
  const first = repo.toggleItem("watchlist", input);
  expect(first).toBe("added");
  expect(repo.isInList("watchlist", "tmdb:42")).toBe(true);

  const second = repo.toggleItem("watchlist", input);
  expect(second).toBe("removed");
  expect(repo.isInList("watchlist", "tmdb:42")).toBe(false);

  db.close();
});

test("ListRepository: deleteList cascades to list_items", () => {
  const db = migratedDataDb();
  const repo = new ListRepository(db);

  const list = repo.createList({ name: "Temp", kind: "custom" });
  repo.addItem({ listId: list.id, titleId: "tmdb:1", mediaKind: "series", title: "Test" });
  expect(repo.getItems(list.id).length).toBe(1);

  repo.deleteList(list.id);
  expect(repo.getList(list.id)).toBeUndefined();
  expect(repo.getItems(list.id).length).toBe(0);

  db.close();
});

test("ListRepository: getListsForTitle returns all lists containing title", () => {
  const db = migratedDataDb();
  const repo = new ListRepository(db);

  const custom = repo.createList({ name: "Custom", kind: "custom" });
  repo.addItem({ listId: "watchlist", titleId: "tmdb:99", mediaKind: "series", title: "X" });
  repo.addItem({ listId: custom.id, titleId: "tmdb:99", mediaKind: "series", title: "X" });

  const lists = repo.getListsForTitle("tmdb:99");
  expect(lists.length).toBe(2);
  expect(lists.some((l) => l.id === "watchlist")).toBe(true);
  expect(lists.some((l) => l.id === custom.id)).toBe(true);

  db.close();
});

test("ListRepository: isInList returns false for absent title", () => {
  const db = migratedDataDb();
  const repo = new ListRepository(db);

  expect(repo.isInList("watchlist", "tmdb:nothere")).toBe(false);

  db.close();
});

// ─── PlaylistRepository ────────────────────────────────────────────────────────

test("PlaylistRepository: enqueue + peekNext returns first by priority DESC addedAt ASC", () => {
  const db = migratedDataDb();
  const repo = new PlaylistRepository(db);
  const sid = "session-1";

  repo.enqueue({
    title: "Low",
    mediaKind: "anime",
    titleId: "tmdb:1",
    priority: 0,
    source: "manual",
    sessionId: sid,
  });
  repo.enqueue({
    title: "High",
    mediaKind: "anime",
    titleId: "tmdb:2",
    priority: 10,
    source: "manual",
    sessionId: sid,
  });

  const next = repo.peekNext(sid);
  expect(next?.title).toBe("High");

  db.close();
});

test("PlaylistRepository: markPlayed excludes item from getUnplayed", () => {
  const db = migratedDataDb();
  const repo = new PlaylistRepository(db);
  const sid = "session-2";

  const item = repo.enqueue({
    title: "A",
    mediaKind: "series",
    titleId: "tmdb:10",
    source: "watchlist",
    sessionId: sid,
  });
  expect(repo.countUnplayed(sid)).toBe(1);

  repo.markPlayed(item.id);
  expect(repo.countUnplayed(sid)).toBe(0);
  expect(repo.getUnplayed(sid).length).toBe(0);

  const all = repo.getAll(sid);
  expect(all.length).toBe(1);
  expect(all[0]!.playedAt).toBeDefined();

  db.close();
});

test("PlaylistRepository: clear removes all items for session", () => {
  const db = migratedDataDb();
  const repo = new PlaylistRepository(db);
  const sid = "session-3";

  repo.enqueue({
    title: "A",
    mediaKind: "series",
    titleId: "tmdb:1",
    source: "manual",
    sessionId: sid,
  });
  repo.enqueue({
    title: "B",
    mediaKind: "series",
    titleId: "tmdb:2",
    source: "manual",
    sessionId: sid,
  });
  expect(repo.getAll(sid).length).toBe(2);

  repo.clear(sid);
  expect(repo.getAll(sid).length).toBe(0);

  db.close();
});

test("PlaylistRepository: clearPlayed only removes played items", () => {
  const db = migratedDataDb();
  const repo = new PlaylistRepository(db);
  const sid = "session-4";

  const a = repo.enqueue({
    title: "A",
    mediaKind: "anime",
    titleId: "tmdb:1",
    source: "manual",
    sessionId: sid,
  });
  repo.enqueue({
    title: "B",
    mediaKind: "anime",
    titleId: "tmdb:2",
    source: "manual",
    sessionId: sid,
  });
  repo.markPlayed(a.id);

  repo.clearPlayed(sid);
  const remaining = repo.getAll(sid);
  expect(remaining.length).toBe(1);
  expect(remaining[0]!.title).toBe("B");

  db.close();
});

test("PlaylistRepository: getLastActivity returns latest addedAt across sessions", () => {
  const db = migratedDataDb();
  const repo = new PlaylistRepository(db);

  expect(repo.getLastActivity()).toBeUndefined();

  repo.enqueue({
    title: "X",
    mediaKind: "anime",
    titleId: "tmdb:1",
    source: "manual",
    sessionId: "s1",
  });
  const activity = repo.getLastActivity();
  expect(typeof activity).toBe("string");
  expect(activity!.length).toBeGreaterThan(0);

  db.close();
});

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
