import { expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openKunaiDatabaseWithCorruptionRecovery } from "../src/sqlite";

test("quarantines a corrupt database file and opens a fresh one", () => {
  const dir = mkdtempSync(join(tmpdir(), "kunai-sqlite-recovery-"));
  // Hoisted so `finally` can close it even when an assertion throws first.
  let db: ReturnType<typeof openKunaiDatabaseWithCorruptionRecovery>["db"] | undefined;
  try {
    const dbPath = join(dir, "kunai-data.sqlite");
    writeFileSync(dbPath, "this is definitely not a sqlite database");

    const messages: string[] = [];
    const { db: opened, quarantinedCorruptDb } = openKunaiDatabaseWithCorruptionRecovery(
      dbPath,
      {},
      (message) => messages.push(message),
    );
    db = opened;

    expect(quarantinedCorruptDb).toBe(true);
    expect(messages.length).toBe(1);
    expect(messages[0]).toContain("unreadable");
    expect(messages[0]).toContain(".corrupt.");

    const backups = readdirSync(dir).filter(
      (name) => name.includes(".corrupt.") && name.endsWith(".bak"),
    );
    expect(backups.length).toBe(1);

    // The replacement database must actually be usable.
    db.exec("CREATE TABLE recovery_probe (id INTEGER)");
  } finally {
    // Closing inside the `try` means a failing assertion above skips it, and
    // `rmSync` then hits an open SQLite handle — EBUSY on Windows, which
    // replaces the real assertion failure with a confusing teardown error.
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("opens a healthy database without touching it", () => {
  const dir = mkdtempSync(join(tmpdir(), "kunai-sqlite-recovery-healthy-"));
  try {
    const dbPath = join(dir, "kunai-data.sqlite");
    const first = openKunaiDatabaseWithCorruptionRecovery(dbPath);
    expect(first.quarantinedCorruptDb).toBe(false);
    first.db.exec("CREATE TABLE durable (id INTEGER)");
    first.db.close();

    const second = openKunaiDatabaseWithCorruptionRecovery(dbPath);
    expect(second.quarantinedCorruptDb).toBe(false);
    // Data survives: no spurious quarantine between launches.
    second.db.query("SELECT count(*) AS n FROM durable").get();
    second.db.close();
    expect(existsSync(`${dbPath}.corrupt.bak`)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The corrupt main file is the only artifact worth keeping, and it is kept.
 *
 * Its `-wal`/`-shm` siblings do not survive, and cannot: the failing handle has
 * to be closed before the rename — on Windows an open handle is exactly what
 * makes `renameSync` fail with EBUSY — and SQLite deletes both siblings as part
 * of that close. Measured, not assumed. No loss either way: a WAL cannot be
 * replayed without a database that opens, so an orphaned one is already dead.
 */
test("quarantines the corrupt main file and does not strand its siblings", () => {
  const dir = mkdtempSync(join(tmpdir(), "kunai-sqlite-recovery-wal-"));
  try {
    const dbPath = join(dir, "kunai-data.sqlite");
    writeFileSync(dbPath, "corrupt main file");
    writeFileSync(`${dbPath}-wal`, "stale wal");
    writeFileSync(`${dbPath}-shm`, "stale shm");

    const { db, quarantinedCorruptDb } = openKunaiDatabaseWithCorruptionRecovery(dbPath);
    expect(quarantinedCorruptDb).toBe(true);

    const backups = readdirSync(dir).filter(
      (name) => name.includes(".corrupt.") && name.endsWith(".bak"),
    );

    // The invariant, not the sibling count. Whether `-wal`/`-shm` survive the
    // close is platform-dependent — Linux SQLite removes them, macOS leaves
    // them for the quarantine to move — and either is fine. What must hold
    // everywhere is that the *database* is preserved under its own name, so a
    // `-wal` backup can never be mistaken for it.
    const dbBackups = backups.filter((name) => name.startsWith("kunai-data.sqlite.corrupt."));
    expect(dbBackups).toHaveLength(1);
    expect(readFileSync(join(dir, dbBackups[0] as string), "utf8")).toBe("corrupt main file");
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("leaves the wal in place when the database itself cannot be quarantined", () => {
  const dir = mkdtempSync(join(tmpdir(), "kunai-sqlite-recovery-locked-"));
  const dbPath = join(dir, "kunai-data.sqlite");
  const rename = fs.renameSync;
  const messages: string[] = [];
  let blockedMainRename = false;
  const renameSpy = spyOn(fs, "renameSync").mockImplementation((source, target) => {
    if (source !== dbPath) return rename(source, target);
    blockedMainRename = true;
    // SQLite may remove invalid siblings when closing the failed handle. Set
    // up the surviving-sibling case at the filesystem failure boundary so the
    // quarantine ordering contract is exercised on every OS, including root.
    writeFileSync(`${dbPath}-wal`, "uncheckpointed history lives here");
    writeFileSync(`${dbPath}-shm`, "shared memory index");
    throw Object.assign(new Error("database is held open"), { code: "EBUSY" });
  });
  try {
    writeFileSync(dbPath, "this is definitely not a sqlite database");
    expect(() =>
      openKunaiDatabaseWithCorruptionRecovery(dbPath, {}, (message) => messages.push(message)),
    ).toThrow();
    expect(blockedMainRename).toBe(true);
    expect(messages).toEqual([]);
    const names = readdirSync(dir);
    // Nothing moved, so nothing was separated from anything else.
    expect(names.filter((name) => name.includes(".corrupt."))).toHaveLength(0);
    expect([...names].sort()).toEqual([
      "kunai-data.sqlite",
      "kunai-data.sqlite-shm",
      "kunai-data.sqlite-wal",
    ]);
    expect(readFileSync(dbPath, "utf8")).toBe("this is definitely not a sqlite database");
    expect(readFileSync(`${dbPath}-wal`, "utf8")).toBe("uncheckpointed history lives here");
    expect(readFileSync(`${dbPath}-shm`, "utf8")).toBe("shared memory index");
  } finally {
    renameSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});
