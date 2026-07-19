import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DiagnosticEventsRepository,
  openKunaiDatabase,
  runMigrations,
  type KunaiDatabase,
} from "../src/index";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("diagnostic events repository stores redacted cache events and lists recent rows", () => {
  const db = migratedCacheDb();
  const repo = new DiagnosticEventsRepository(db);

  repo.insert({
    timestamp: 1_771_802_400_000,
    level: "warn",
    category: "playback",
    operation: "playback.startup.timeline",
    message: "Playback startup resolved",
    sessionId: "session-1",
    playbackCycleId: "playback-1",
    providerAttemptId: "provider-1",
    traceId: "trace-1",
    spanId: "span-1",
    titleId: "tmdb:1",
    providerId: "videasy",
    season: 1,
    episode: 2,
    context: {
      streamUrl: "https://cdn.example/stream.m3u8?token=[redacted]&quality=1080p",
      outcome: "cached-fallback",
    },
  });

  expect(repo.listRecent(5)).toEqual([
    expect.objectContaining({
      level: "warn",
      category: "playback",
      operation: "playback.startup.timeline",
      sessionId: "session-1",
      context: {
        streamUrl: "https://cdn.example/stream.m3u8?token=[redacted]&quality=1080p",
        outcome: "cached-fallback",
      },
    }),
  ]);

  db.close();
});

test("diagnostic events repository lists current-session rows only", () => {
  const db = migratedCacheDb();
  const repository = new DiagnosticEventsRepository(db);

  repository.insert({
    timestamp: 10,
    level: "info",
    category: "runtime",
    operation: "runtime.live",
    message: "live-1",
    sessionId: "session-live",
  });
  repository.insert({
    timestamp: 20,
    level: "info",
    category: "runtime",
    operation: "runtime.old",
    message: "old-1",
    sessionId: "session-old",
  });
  repository.insert({
    timestamp: 30,
    level: "warn",
    category: "runtime",
    operation: "runtime.live",
    message: "live-2",
    sessionId: "session-live",
  });

  expect(repository.listBySession("session-live", 10).map((event) => event.sessionId)).toEqual([
    "session-live",
    "session-live",
  ]);
  expect(repository.listBySession("session-live", 10).map((event) => event.message)).toEqual([
    "live-2",
    "live-1",
  ]);

  db.close();
});

test("diagnostic event pruning is bounded to diagnostic rows only", () => {
  const db = migratedCacheDb();
  const repo = new DiagnosticEventsRepository(db);
  seedStreamCacheRow(db);

  for (let index = 0; index < 4; index += 1) {
    repo.insert({
      timestamp: Date.parse(`2026-02-0${index + 1}T00:00:00.000Z`),
      level: index === 0 ? "error" : "info",
      category: "runtime",
      operation: `runtime.event.${index}`,
      message: `event ${index}`,
    });
  }

  const result = repo.prune({
    now: new Date("2026-02-04T00:00:00.000Z"),
    maxEvents: 2,
    retentionDays: 2,
  });

  expect(result.deleted).toBe(2);
  expect(repo.listRecent(10).map((event) => event.operation)).toEqual([
    "runtime.event.3",
    "runtime.event.2",
  ]);
  expect(count(db, "stream_cache")).toBe(1);

  db.close();
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kunai-diagnostics-repo-"));
  tempDirs.push(dir);
  return dir;
}

function migratedCacheDb(): KunaiDatabase {
  const db = openKunaiDatabase(join(makeTempDir(), "cache.sqlite"));
  runMigrations(db, "cache");
  return db;
}

function seedStreamCacheRow(db: KunaiDatabase): void {
  db.query(
    `
      INSERT INTO stream_cache (
        cache_key, schema_version, provider_id, stream_json,
        expires_at, created_at, last_accessed_at, hit_count
      )
      VALUES ('stream-1', 1, 'videasy', '{}', ?, ?, ?, 0)
    `,
  ).run("2026-02-05T00:00:00.000Z", "2026-02-04T00:00:00.000Z", "2026-02-04T00:00:00.000Z");
}

function count(db: KunaiDatabase, table: string): number {
  return (
    db.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count ?? 0
  );
}
