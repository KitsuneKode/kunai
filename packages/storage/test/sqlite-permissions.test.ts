import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openKunaiDatabase } from "../src/sqlite";

const dirs: string[] = [];
const dbs: ReturnType<typeof openKunaiDatabase>[] = [];

afterEach(() => {
  Bun.gc(true);
  for (const db of dbs.splice(0)) {
    try {
      (db as unknown as { clearQueryCache?: () => void }).clearQueryCache?.();
      db.close(true);
    } catch {
      // already closed
    }
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "win32")(
  "openKunaiDatabase chmods the database to owner-only on POSIX",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "kunai-sqlite-perms-"));
    dirs.push(dir);
    const dbPath = join(dir, "test.sqlite");

    const db = openKunaiDatabase(dbPath);
    dbs.push(db);
    db.exec("PRAGMA user_version = 1");

    expect(statSync(dbPath).mode & 0o777).toBe(0o600);
  },
);

test.skipIf(process.platform === "win32")(
  "openKunaiDatabase heals an existing 0644 database to 0600 on reopen",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "kunai-sqlite-perms-heal-"));
    dirs.push(dir);
    const dbPath = join(dir, "test.sqlite");

    const db1 = openKunaiDatabase(dbPath);
    db1.close(true);

    chmodSync(dbPath, 0o644);
    expect(statSync(dbPath).mode & 0o777).toBe(0o644);

    const db2 = openKunaiDatabase(dbPath);
    dbs.push(db2);

    expect(statSync(dbPath).mode & 0o777).toBe(0o600);
  },
);
