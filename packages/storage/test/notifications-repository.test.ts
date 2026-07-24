import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NotificationRepository, openKunaiDatabase, runMigrations } from "../src/index";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "kunai-notifications-"));
  tempDirs.push(dir);
  const db = openKunaiDatabase(join(dir, "data.sqlite"));
  runMigrations(db, "data");
  return new NotificationRepository(db);
}

const base = (dedupKey: string, updatedAt: string) => ({
  dedupKey,
  kind: "new-episode",
  title: `T ${dedupKey}`,
  body: "b",
  createdAt: updatedAt,
  updatedAt,
});

test("NotificationRepository: counts unread, marks read, clears unread", () => {
  const r = repo();
  r.upsert(base("a", "2026-06-14T01:00:00.000Z"));
  r.upsert(base("b", "2026-06-14T02:00:00.000Z"));
  expect(r.countUnread()).toBe(2);
  r.markRead("a", "2026-06-14T03:00:00.000Z");
  expect(r.countUnread()).toBe(1);
  // The return value is what the inbox reports back to the user, so it has to
  // be how many were actually marked — not how many rows exist.
  expect(r.markAllRead("2026-06-14T04:00:00.000Z")).toBe(1);
  expect(r.countUnread()).toBe(0);
  expect(r.markAllRead("2026-06-14T05:00:00.000Z")).toBe(0);
});

test("NotificationRepository: archive removes from active and appears in archived", () => {
  const r = repo();
  r.upsert(base("a", "2026-06-14T01:00:00.000Z"));
  r.archive("a", "2026-06-14T05:00:00.000Z");
  expect(r.listActive(50, 0).map((n) => n.dedupKey)).not.toContain("a");
  expect(r.listArchived(50, 0).map((n) => n.dedupKey)).toContain("a");
});

test("NotificationRepository: paginates active notifications", () => {
  const r = repo();
  for (let i = 0; i < 5; i++) r.upsert(base(`k${i}`, `2026-06-14T0${i}:00:00.000Z`));
  expect(r.listActive(2, 0)).toHaveLength(2);
  expect(r.listActive(2, 4)).toHaveLength(1);
});

test("NotificationRepository: complete lists return every row beyond the limited page", () => {
  const r = repo();
  r.upsert(base("active-1", "2026-07-16T01:00:00.000Z"));
  r.upsert(base("active-2", "2026-07-16T02:00:00.000Z"));
  r.upsert(base("active-3", "2026-07-16T03:00:00.000Z"));
  r.upsert(base("archived-1", "2026-07-16T04:00:00.000Z"));
  r.upsert(base("archived-2", "2026-07-16T05:00:00.000Z"));
  // archive() replaces updated_at with the archive timestamp.
  r.archive("archived-1", "2026-07-16T06:00:00.000Z");
  r.archive("archived-2", "2026-07-16T07:00:00.000Z");

  expect(r.listActive(2, 0)).toHaveLength(2);
  expect(r.listAllActive().map((row) => row.dedupKey)).toEqual([
    "active-3",
    "active-2",
    "active-1",
  ]);
  expect(r.listAllArchived().map((row) => row.dedupKey)).toEqual(["archived-2", "archived-1"]);
});

test("NotificationRepository: complete lists are not capped at legacy page sizes", () => {
  const r = repo();
  for (let index = 0; index < 205; index += 1) {
    r.upsert(base(`active-${index}`, new Date(Date.UTC(2026, 6, 1, 0, 0, index)).toISOString()));
  }
  for (let index = 0; index < 55; index += 1) {
    const key = `archived-${index}`;
    r.upsert(base(key, new Date(Date.UTC(2026, 6, 2, 0, 0, index)).toISOString()));
    r.archive(key, new Date(Date.UTC(2026, 6, 3, 0, 0, index)).toISOString());
  }

  expect(r.listActive()).toHaveLength(50);
  expect(r.listArchived()).toHaveLength(50);
  const active = r.listAllActive();
  const archived = r.listAllArchived();
  expect(active).toHaveLength(205);
  expect(active[0]?.dedupKey).toBe("active-204");
  expect(active.at(-1)?.dedupKey).toBe("active-0");
  expect(archived).toHaveLength(55);
  expect(archived[0]?.dedupKey).toBe("archived-54");
  expect(archived.at(-1)?.dedupKey).toBe("archived-0");
});

test("NotificationRepository: delete removes a single notification permanently", () => {
  const r = repo();
  r.upsert(base("a", "2026-06-14T01:00:00.000Z"));
  r.deleteByDedupKey("a");
  expect(r.getByDedupKey("a")).toBeUndefined();
  expect(r.listActive(50, 0)).toHaveLength(0);
});

test("NotificationRepository: deleteByKind removes all rows of a kind", () => {
  const r = repo();
  r.upsert({ ...base("q1", "2026-06-14T01:00:00.000Z"), kind: "queue-recovery" });
  r.upsert({ ...base("q2", "2026-06-14T02:00:00.000Z"), kind: "queue-recovery" });
  r.upsert({ ...base("n1", "2026-06-14T03:00:00.000Z"), kind: "new-episode" });
  const removed = r.deleteByKind("queue-recovery");
  expect(removed).toBe(2);
  expect(r.listActive(50, 0).map((n) => n.dedupKey)).toEqual(["n1"]);
});

test("NotificationRepository: clearArchived purges only archived rows", () => {
  const r = repo();
  r.upsert(base("a", "2026-06-14T01:00:00.000Z"));
  r.upsert(base("b", "2026-06-14T02:00:00.000Z"));
  r.archive("a", "2026-06-14T03:00:00.000Z");
  const removed = r.clearArchived();
  expect(removed).toBe(1);
  expect(r.listArchived(50, 0)).toHaveLength(0);
  expect(r.listActive(50, 0).map((n) => n.dedupKey)).toEqual(["b"]);
});

test("NotificationRepository: dismissed notices leave the active list and counts", () => {
  const r = repo();
  r.upsert(base("older", "2026-06-14T01:00:00.000Z"));
  r.upsert(base("target", "2026-06-14T02:00:00.000Z"));
  r.upsert(base("newer", "2026-06-14T03:00:00.000Z"));
  expect(r.countActive()).toBe(3);
  expect(r.countUnread()).toBe(3);

  // Whatever mechanism dismiss uses, the observable contract is the same:
  // the notice leaves the active list, both counts drop, and it must NOT be
  // reordered to the top (the old dismissByDedupKey bumped updated_at, which
  // promoted the dismissed row instead of hiding it).
  r.archive("target", "2026-06-14T09:00:00.000Z");

  const activeKeys = r.listActive().map((row) => row.dedupKey);
  expect(activeKeys).not.toContain("target");
  expect(activeKeys).toEqual(["newer", "older"]);
  expect(r.countActive()).toBe(2);
  expect(r.countUnread()).toBe(2);
});
