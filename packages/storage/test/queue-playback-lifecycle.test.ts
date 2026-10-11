import { afterEach, expect, test } from "bun:test";

import { dataMigrations, openKunaiDatabase, QueueRepository, runMigrations } from "../src/index";
import { createTempStoreRegistry } from "./helpers/temp-store";

const stores = createTempStoreRegistry();
const NOW = "2026-07-20T12:00:00.000Z";

afterEach(() => {
  stores.cleanup();
});

function createRepo(): QueueRepository {
  const db = stores.store("queue-lifecycle", "data");
  const repo = new QueueRepository(db);
  repo.createQueueSession({
    id: "session",
    status: "active",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:00.000Z",
  });
  return repo;
}

function enqueue(repo: QueueRepository, sessionId: string, title: string) {
  return repo.enqueue({
    title,
    mediaKind: "anime",
    titleId: `anilist:${title}`,
    absoluteEpisode: 1,
    queuePosition: title === "a" || title === "first" ? 0 : 1,
    source: "manual",
    sessionId,
  });
}

test("acknowledges only the exact in-flight id", () => {
  const repo = createRepo();
  const a = enqueue(repo, "session", "a");
  const b = enqueue(repo, "session", "b");
  repo.markInFlight(b.id, "session", "2026-07-20T10:00:00.000Z");

  expect(repo.acknowledgePlaybackStarted(a.id, "session", NOW)).toBe(false);
  expect(repo.acknowledgePlaybackStarted(b.id, "session", NOW)).toBe(true);
  expect(repo.getById(a.id)?.status).toBe("pending");
  expect(repo.getById(b.id)?.status).toBe("played");
});

test("pre-start rollback preserves position and failure context", () => {
  const repo = createRepo();
  const first = enqueue(repo, "session", "first");
  const second = enqueue(repo, "session", "second");
  repo.markInFlight(first.id, "session", NOW);
  expect(
    repo.restoreInFlightToPending(first.id, "session", {
      code: "mpv-launch-failed",
      stage: "player-launch",
      at: NOW,
    }),
  ).toBe(true);
  expect(repo.getAllForSession("session").map((row) => row.id)).toEqual([first.id, second.id]);
  expect(repo.getById(first.id)?.status).toBe("pending");
  expect(repo.getById(first.id)?.queuePosition).toBe(0);
  expect(repo.getById(first.id)?.lastFailure).toEqual({
    code: "mpv-launch-failed",
    stage: "player-launch",
    at: NOW,
  });
  expect(repo.getById(first.id)?.inFlightAt).toBeUndefined();
});

test("claim is compare-and-set on pending rows only", () => {
  const repo = createRepo();
  const first = enqueue(repo, "session", "first");
  const second = enqueue(repo, "session", "second");

  expect(repo.markInFlight(first.id, "session", NOW)).toBe(true);
  expect(repo.markInFlight(first.id, "session", NOW)).toBe(false);
  expect(repo.markInFlight(second.id, "other-session", NOW)).toBe(false);
  expect(repo.getById(first.id)?.status).toBe("in-flight");
  expect(repo.getById(first.id)?.inFlightAt).toBe(NOW);
  expect(repo.getById(second.id)?.status).toBe("pending");
});

test("queue transitions update session last_activity_at", () => {
  const repo = createRepo();
  const entry = enqueue(repo, "session", "first");
  expect(repo.markInFlight(entry.id, "session", "2026-07-20T10:00:00.000Z")).toBe(true);
  expect(repo.getQueueSession("session")?.lastActivityAt).toBe("2026-07-20T10:00:00.000Z");

  expect(
    repo.restoreInFlightToPending(entry.id, "session", {
      code: "provider-exhausted",
      stage: "provider-resolution",
      at: "2026-07-20T10:05:00.000Z",
    }),
  ).toBe(true);
  expect(repo.getQueueSession("session")?.lastActivityAt).toBe("2026-07-20T10:05:00.000Z");

  expect(repo.markInFlight(entry.id, "session", "2026-07-20T10:10:00.000Z")).toBe(true);
  expect(repo.acknowledgePlaybackStarted(entry.id, "session", "2026-07-20T10:15:00.000Z")).toBe(
    true,
  );
  expect(repo.getQueueSession("session")?.lastActivityAt).toBe("2026-07-20T10:15:00.000Z");
});

test("restore resets in-flight, places contiguous block, and returns restored ids", () => {
  const repo = createRepo();
  repo.createQueueSession({
    id: "old",
    status: "recoverable",
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T01:00:00.000Z",
  });
  const playedCurrent = enqueue(repo, "session", "played-current");
  repo.markPlayed(playedCurrent.id);
  enqueue(repo, "session", "current-a");
  enqueue(repo, "session", "current-b");
  const restoredA = enqueue(repo, "old", "restored-a");
  const restoredB = enqueue(repo, "old", "restored-b");
  expect(repo.markInFlight(restoredA.id, "old", "2026-07-19T00:55:00.000Z")).toBe(true);

  const restoredIds = repo.restoreQueueSession("old", "session", NOW);

  expect(restoredIds).toEqual([restoredA.id, restoredB.id]);
  expect(repo.getById(restoredA.id)?.status).toBe("pending");
  expect(repo.getById(restoredA.id)?.inFlightAt).toBeUndefined();
  expect(repo.getAll("session").map((row) => row.titleId)).toEqual([
    "anilist:played-current",
    "anilist:restored-a",
    "anilist:restored-b",
    "anilist:current-a",
    "anilist:current-b",
  ]);
  expect(repo.getQueueSession("old")?.status).toBe("closed");
});

/**
 * Enqueueing several items in one burst — "add whole season" — can give every
 * row the same `added_at`, because that column only has millisecond precision.
 * `queue_position` is NULL until something reorders, and `priority` defaults to
 * 0, so the sort keys tie completely and SQLite may return the set in any
 * order. It returned insertion order on Linux and a different order on macOS,
 * which is how this surfaced.
 *
 * The tie is forced rather than raced. Relying on five inserts landing inside
 * one millisecond is exactly the kind of timing assumption that passes on one
 * machine and fails on another — which is the bug this test exists for, so the
 * test must not reproduce it.
 */
test("queue order is deterministic when every sort key ties", () => {
  const db = stores.store("queue-tiebreak", "data");
  const repo = new QueueRepository(db);
  repo.createQueueSession({
    id: "session",
    status: "active",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:00.000Z",
  });

  const ids = ["first", "second", "third", "fourth", "fifth"];
  for (const titleId of ids) {
    repo.enqueue({
      title: titleId,
      mediaKind: "series",
      titleId,
      source: "manual",
      sessionId: "session",
    });
  }

  // Collapse every timestamp onto one value: the exact state a fast burst
  // produces, now guaranteed instead of hoped for.
  db.query("UPDATE playlist_queue SET added_at = ? WHERE session_id = ?").run(
    "2026-07-20T09:00:00.000Z",
    "session",
  );
  const stamps = db
    .query<{ added_at: string }, []>("SELECT added_at FROM playlist_queue")
    .all()
    .map((row) => row.added_at);
  expect(new Set(stamps).size).toBe(1);

  expect(repo.getAll("session").map((item) => item.titleId)).toEqual(ids);
  expect(repo.getUnplayed("session").map((item) => item.titleId)).toEqual(ids);
  expect(repo.peekNext("session")?.titleId).toBe("first");

  // Repeated reads must agree with each other, not merely be plausible.
  for (let i = 0; i < 5; i += 1) {
    expect(repo.getAll("session").map((item) => item.titleId)).toEqual(ids);
  }
});

test("migration backfills pre-lifecycle played rows so they cannot be claimed as zombies", () => {
  // Rows written before migration 010 carried played_at but no status column;
  // the column was added DEFAULT 'pending', leaving reads (played_at IS NULL)
  // and claims (status = 'pending') disagreeing. Replay that history.
  const db = openKunaiDatabase(":memory:");
  const migrationIndex = dataMigrations.findIndex(
    (migration) => migration.id === "040_data_queue_played_status_backfill",
  );
  expect(migrationIndex).toBeGreaterThan(0);
  runMigrations(db, "data", dataMigrations.slice(0, migrationIndex));

  const at = "2026-07-20T09:00:00.000Z";
  db.query(
    `INSERT INTO playback_queue_sessions (id, status, created_at, updated_at)
     VALUES ('session', 'active', ?, ?)`,
  ).run(at, at);
  db.query(
    `INSERT INTO playlist_queue
       (id, title, media_kind, title_id, priority, source, added_at, played_at, session_id)
     VALUES ('legacy-played', 'Already played', 'series', 'tmdb:9', 0, 'manual', ?, ?, 'session')`,
  ).run(at, "2026-07-20T10:00:00.000Z");
  db.query(
    `INSERT INTO playlist_queue
       (id, title, media_kind, title_id, priority, source, added_at, session_id)
     VALUES ('still-pending', 'Unwatched', 'series', 'tmdb:10', 1, 'manual', ?, 'session')`,
  ).run(at);

  runMigrations(db, "data");

  const repo = new QueueRepository(db);
  expect(repo.getById("legacy-played")?.status).toBe("played");
  expect(repo.getById("still-pending")?.status).toBe("pending");
  expect(repo.markInFlight("legacy-played", "session", NOW)).toBe(false);
  expect(repo.markInFlight("still-pending", "session", NOW)).toBe(true);
});

test("the claim CAS refuses a pending row that already has played_at, even if written post-migration", () => {
  // Defense in depth behind the backfill: a future writer that stamps
  // played_at without touching status must not create a claimable zombie.
  const db = stores.store("queue-zombie", "data");
  const zombieRepo = new QueueRepository(db);
  zombieRepo.createQueueSession({
    id: "session",
    status: "active",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:00.000Z",
  });
  const zombie = zombieRepo.enqueue({
    title: "zombie",
    mediaKind: "anime",
    titleId: "anilist:zombie",
    source: "manual",
    sessionId: "session",
  });
  db.query("UPDATE playlist_queue SET played_at = ? WHERE id = ?").run(NOW, zombie.id);

  expect(zombieRepo.markInFlight(zombie.id, "session", NOW)).toBe(false);
  expect(zombieRepo.getById(zombie.id)?.status).toBe("pending");
});

test("non-object external_ids_json values read as absent, not as truthy garbage", () => {
  const db = stores.store("queue-external-ids", "data");
  const repo = new QueueRepository(db);
  repo.createQueueSession({
    id: "session",
    status: "active",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:00.000Z",
  });
  const entry = repo.enqueue({
    title: "ids",
    mediaKind: "anime",
    titleId: "anilist:ids",
    source: "manual",
    sessionId: "session",
  });
  expect(repo.getById(entry.id)?.externalIds).toBeUndefined();

  for (const bad of ["42", '"imdb:tt123"', "[1,2,3]", "{corrupt"]) {
    db.query("UPDATE playlist_queue SET external_ids_json = ? WHERE id = ?").run(bad, entry.id);
    expect(repo.getById(entry.id)?.externalIds).toBeUndefined();
  }

  db.query("UPDATE playlist_queue SET external_ids_json = ? WHERE id = ?").run(
    JSON.stringify({ anilistId: "123" }),
    entry.id,
  );
  expect(repo.getById(entry.id)?.externalIds).toEqual({ anilistId: "123" });
});
