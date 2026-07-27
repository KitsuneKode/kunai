import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openKunaiDatabase, runMigrations, type KunaiDatabase } from "../../src/index";

export type TempStoreKind = "data" | "cache";

/**
 * Tracks the throwaway directories and databases a suite opens, so teardown
 * disposes of them in the only order Windows accepts: close every handle first,
 * then remove the directory.
 *
 * Leaking a database handle past `rmSync` is invisible on POSIX -- it unlinks
 * open files happily -- and fails on Windows with EBUSY *after* the test's
 * assertions have already passed, which reads as a broken test rather than a
 * broken teardown. Retrying does not help: SQLite holds the file (and its `-wal`
 * / `-shm` siblings) for the life of the process, so the close has to happen.
 *
 * This is the single implementation; `@kunai/storage/testing` publishes it so
 * the CLI suites use the same one rather than a second copy that can drift.
 */
export type TempStoreRegistry = {
  /** Create a tracked temp directory. */
  dir(name: string): string;
  /** Open and migrate a tracked database inside `dir`. */
  db(dir: string, kind?: TempStoreKind): KunaiDatabase;
  /** Tracked directory plus a migrated database in it -- the common case. */
  store(name: string, kind?: TempStoreKind): KunaiDatabase;
  /** Close tracked databases, then remove tracked directories. */
  cleanup(): void;
};

export function createTempStoreRegistry(): TempStoreRegistry {
  const dirs: string[] = [];
  const dbs: KunaiDatabase[] = [];

  const registry: TempStoreRegistry = {
    dir(name) {
      const created = mkdtempSync(join(tmpdir(), `kunai-${name}-`));
      dirs.push(created);
      return created;
    },
    db(dir, kind = "data") {
      const database = openKunaiDatabase(join(dir, `${kind}.sqlite`));
      runMigrations(database, kind);
      dbs.push(database);
      return database;
    },
    store(name, kind = "data") {
      return registry.db(registry.dir(name), kind);
    },
    cleanup() {
      // Two things pin a SQLite handle open past `close()`, and neither is
      // visible on POSIX -- it unlinks open files happily. On Windows both
      // surface as EBUSY during teardown, with the `-wal` and `-shm` siblings
      // still on disk, long after the test's assertions have passed:
      //
      //   1. Bun caches a prepared statement per distinct `db.query()` SQL.
      //   2. `db.transaction()` prepares BEGIN/COMMIT/ROLLBACK statements that
      //      stay alive until the transaction function itself is collected.
      //
      // A synchronous GC settles (2), `clearQueryCache()` settles (1). Only then
      // can sqlite3_close() actually release the file -- `close()` without them
      // returns "database is locked" and, passed no argument, reports success
      // anyway. Retrying the `rmSync` does not help: nothing frees the handle
      // later, so the close has to genuinely happen first.
      Bun.gc(true);
      for (const database of dbs.splice(0)) {
        // A suite may already have closed one; teardown must still finish.
        try {
          // `clearQueryCache` exists on Bun's Database at runtime but is absent
          // from the bundled type declarations, so it needs a narrow cast rather
          // than a blanket `any` on the handle.
          (database as unknown as { clearQueryCache?: () => void }).clearQueryCache?.();
          database.close(true);
        } catch {
          // already closed
        }
      }
      for (const dir of dirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };

  return registry;
}
