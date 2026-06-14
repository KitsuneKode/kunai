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
  r.markAllRead("2026-06-14T04:00:00.000Z");
  expect(r.countUnread()).toBe(0);
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
