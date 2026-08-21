import { expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
    // Exactly the database, under its own name — never a `-wal` backup that a
    // reader would mistake for one.
    expect(backups).toEqual([expect.stringContaining("kunai-data.sqlite.corrupt.")]);
    expect(backups.some((name) => name.includes("-wal") || name.includes("-shm"))).toBe(false);
    expect(readFileSync(join(dir, backups[0] as string), "utf8")).toBe("corrupt main file");
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Reproduces the Windows failure on Linux by making the *directory*
 * unwritable, which is the only way to make `renameSync` fail here. On Windows
 * the rename fails for a different reason — an open handle on the main file
 * returns EBUSY — but the recovery code sees the identical outcome.
 *
 * What must not happen: `-wal` moving aside while the database it belongs to
 * stays put. That detaches uncheckpointed history from its database, which is
 * the data loss this function's comment promises not to cause, and the caller
 * would read the non-empty result as a successful quarantine and log "starting
 * fresh" naming a WAL backup as if it were the database.
 */
test("leaves the wal in place when the database itself cannot be quarantined", () => {
  const dir = mkdtempSync(join(tmpdir(), "kunai-sqlite-recovery-locked-"));
  const dbPath = join(dir, "kunai-data.sqlite");
  try {
    writeFileSync(dbPath, "this is definitely not a sqlite database");
    writeFileSync(`${dbPath}-wal`, "uncheckpointed history lives here");
    writeFileSync(`${dbPath}-shm`, "shared memory index");
    chmodSync(dir, 0o500); // r-x: entries readable, nothing renamed or created.

    expect(() => openKunaiDatabaseWithCorruptionRecovery(dbPath)).toThrow();

    chmodSync(dir, 0o700);
    const names = readdirSync(dir);
    // Nothing moved, so nothing was separated from anything else.
    expect(names.filter((name) => name.includes(".corrupt."))).toHaveLength(0);
    expect([...names].sort()).toEqual([
      "kunai-data.sqlite",
      "kunai-data.sqlite-shm",
      "kunai-data.sqlite-wal",
    ]);
    expect(readFileSync(`${dbPath}-wal`, "utf8")).toBe("uncheckpointed history lives here");
  } finally {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  }
});
