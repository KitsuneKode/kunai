import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CalendarArchiveRepository,
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

function cacheDb(): KunaiDatabase {
  const dir = mkdtempSync(join(tmpdir(), "kunai-cal-archive-"));
  tempDirs.push(dir);
  const db = openKunaiDatabase(join(dir, "cache.sqlite"));
  runMigrations(db, "cache");
  return db;
}

test("archives forward items and reads back only those inside the window, oldest first", () => {
  const repo = new CalendarArchiveRepository(cacheDb());
  repo.archive([
    { titleId: "a", releaseAt: "2026-06-02T10:00:00.000Z", payloadJson: '{"id":"a"}' },
    { titleId: "b", releaseAt: "2026-06-05T10:00:00.000Z", payloadJson: '{"id":"b"}' },
    { titleId: "c", releaseAt: "2026-06-09T10:00:00.000Z", payloadJson: '{"id":"c"}' },
  ]);

  // Past window: 2026-06-01 .. 2026-06-07 → a then b (c is in the future, excluded).
  const window = repo.listInWindow("2026-06-01T00:00:00.000Z", "2026-06-07T00:00:00.000Z");
  expect(window).toEqual(['{"id":"a"}', '{"id":"b"}']);
});

test("upserts on (titleId, releaseAt) — re-archiving refreshes the payload, no duplicate", () => {
  const repo = new CalendarArchiveRepository(cacheDb());
  repo.archive([{ titleId: "a", releaseAt: "2026-06-02T10:00:00.000Z", payloadJson: '{"v":1}' }]);
  repo.archive([{ titleId: "a", releaseAt: "2026-06-02T10:00:00.000Z", payloadJson: '{"v":2}' }]);

  const window = repo.listInWindow("2026-06-01T00:00:00.000Z", "2026-06-03T00:00:00.000Z");
  expect(window).toEqual(['{"v":2}']);
});

test("pruneBefore drops entries older than the retention boundary and reports the count", () => {
  const repo = new CalendarArchiveRepository(cacheDb());
  repo.archive([
    { titleId: "old", releaseAt: "2026-05-20T10:00:00.000Z", payloadJson: "{}" },
    { titleId: "keep", releaseAt: "2026-06-05T10:00:00.000Z", payloadJson: "{}" },
  ]);

  const removed = repo.pruneBefore("2026-06-01T00:00:00.000Z");
  expect(removed).toBe(1);
  expect(repo.listInWindow("2026-05-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z")).toHaveLength(1);
});

test("items without a releaseAt are skipped (cannot be windowed by date)", () => {
  const repo = new CalendarArchiveRepository(cacheDb());
  repo.archive([{ titleId: "x", releaseAt: "", payloadJson: "{}" }]);
  expect(repo.listInWindow("2000-01-01T00:00:00.000Z", "2100-01-01T00:00:00.000Z")).toHaveLength(0);
});
