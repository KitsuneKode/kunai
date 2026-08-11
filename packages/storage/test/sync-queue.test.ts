import { expect, test } from "bun:test";

import {
  openKunaiDatabase,
  runMigrations,
  SYNC_QUEUE_MAX_ATTEMPTS,
  SyncQueueRepository,
  syncQueueBackoffMs,
} from "../src/index";

function repo(): SyncQueueRepository {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  return new SyncQueueRepository(db);
}

test("enqueue collapses repeated pushes for the same unit of progress", () => {
  const queue = repo();
  queue.enqueue({ adapterId: "anilist", dedupeKey: "t|s1|e3", payload: { progress: 3 } });
  queue.enqueue({ adapterId: "anilist", dedupeKey: "t|s1|e3", payload: { progress: 3 } });

  const all = queue.listAll();
  expect(all).toHaveLength(1);
  expect(all[0]?.payload).toEqual({ progress: 3 });
});

test("the same progress for different adapters stays independent", () => {
  const queue = repo();
  queue.enqueue({ adapterId: "anilist", dedupeKey: "t|s1|e3", payload: {} });
  queue.enqueue({ adapterId: "tmdb", dedupeKey: "t|s1|e3", payload: {} });

  expect(queue.listAll()).toHaveLength(2);
});

test("a failed row is not due again until its backoff elapses", () => {
  const queue = repo();
  const now = new Date("2026-01-01T00:00:00.000Z");
  queue.enqueue({ adapterId: "anilist", dedupeKey: "t|s1|e1", payload: {} }, now);

  const [row] = queue.listDue(10, now);
  expect(row).toBeDefined();
  queue.recordFailure(row!.id, "network unreachable", "network", now);

  expect(queue.listDue(10, now)).toHaveLength(0);

  const afterBackoff = new Date(now.getTime() + syncQueueBackoffMs(1) + 1);
  const due = queue.listDue(10, afterBackoff);
  expect(due).toHaveLength(1);
  expect(due[0]?.attempts).toBe(1);
  expect(due[0]?.lastError).toBe("network unreachable");
  expect(due[0]?.lastErrorKind).toBe("network");
});

test("a row stops retrying once it exhausts its attempts and counts as dead", () => {
  const queue = repo();
  let now = new Date("2026-01-01T00:00:00.000Z");
  queue.enqueue({ adapterId: "anilist", dedupeKey: "t|s1|e1", payload: {} }, now);
  const id = queue.listAll()[0]!.id;

  for (let attempt = 0; attempt < SYNC_QUEUE_MAX_ATTEMPTS; attempt += 1) {
    queue.recordFailure(id, "boom", "remote", now);
    now = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  }

  expect(queue.listDue(10, now)).toHaveLength(0);
  expect(queue.deadCount()).toBe(1);
  expect(queue.pendingCount()).toBe(0);
});

test("re-enqueuing a failed row clears its backoff so a user retry is immediate", () => {
  const queue = repo();
  const now = new Date("2026-01-01T00:00:00.000Z");
  queue.enqueue({ adapterId: "anilist", dedupeKey: "t|s1|e1", payload: { v: 1 } }, now);
  queue.recordFailure(queue.listAll()[0]!.id, "boom", "remote", now);
  expect(queue.listDue(10, now)).toHaveLength(0);

  queue.enqueue({ adapterId: "anilist", dedupeKey: "t|s1|e1", payload: { v: 2 } }, now);

  const due = queue.listDue(10, now);
  expect(due).toHaveLength(1);
  expect(due[0]?.attempts).toBe(0);
  expect(due[0]?.payload).toEqual({ v: 2 });
});

test("resetAll revives even exhausted rows for a manual sync", () => {
  const queue = repo();
  const now = new Date("2026-01-01T00:00:00.000Z");
  queue.enqueue({ adapterId: "anilist", dedupeKey: "t|s1|e1", payload: {} }, now);
  const id = queue.listAll()[0]!.id;
  for (let attempt = 0; attempt < SYNC_QUEUE_MAX_ATTEMPTS; attempt += 1) {
    queue.recordFailure(id, "boom", "remote", now);
  }
  expect(queue.deadCount()).toBe(1);

  queue.resetAll(now);

  expect(queue.deadCount()).toBe(0);
  expect(queue.listDue(10, now)).toHaveLength(1);
});

test("removeForAdapter clears only the disconnected adapter's work", () => {
  const queue = repo();
  queue.enqueue({ adapterId: "anilist", dedupeKey: "a", payload: {} });
  queue.enqueue({ adapterId: "tmdb", dedupeKey: "b", payload: {} });

  expect(queue.removeForAdapter("anilist")).toBe(1);
  expect(queue.listAll().map((row) => row.adapterId)).toEqual(["tmdb"]);
});
