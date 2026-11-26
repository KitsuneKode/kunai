import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openKunaiDatabase } from "../src/sqlite";

// PRAGMA synchronous reports 1 for NORMAL and 2 for FULL.
const NORMAL = 1;
const FULL = 2;

const dirs: string[] = [];
const dbs: ReturnType<typeof openKunaiDatabase>[] = [];

afterEach(() => {
  for (const db of dbs.splice(0)) db.close(true);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function open(options?: Parameters<typeof openKunaiDatabase>[1]) {
  const dir = mkdtempSync(join(tmpdir(), "kunai-sqlite-sync-"));
  dirs.push(dir);
  const db = openKunaiDatabase(join(dir, "test.sqlite"), options);
  dbs.push(db);
  return db;
}

const synchronous = (db: ReturnType<typeof openKunaiDatabase>) =>
  db.query<{ synchronous: number }, []>("PRAGMA synchronous").get()?.synchronous;

test("a WAL database commits without waiting on fsync (synchronous = NORMAL)", () => {
  const db = open();
  expect(db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode).toBe(
    "wal",
  );
  expect(synchronous(db)).toBe(NORMAL);
});

test("a rollback-journal database keeps SQLite's FULL default", () => {
  expect(synchronous(open({ wal: false }))).toBe(FULL);
});
