import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";

export type KunaiDatabase = Database;

/**
 * Create the directory a database file will live in.
 *
 * A bare filename ("kunai.sqlite") resolves to a parent of ".", which already
 * exists by definition. POSIX `mkdir -p` treats that as a no-op, but Windows
 * raises EEXIST, so callers that pass a relative path — tests especially — would
 * fail there and nowhere else.
 */
function ensureParentDirectory(path: string): void {
  const parent = dirname(path);
  if (parent === "." || parent === path) return;
  mkdirSync(parent, { recursive: true });
}

function bestEffortChmodOwnerOnly(dbPath: string): void {
  if (dbPath === ":memory:" || dbPath.startsWith("file::memory:")) return;

  try {
    chmodSync(dbPath, 0o600);
  } catch {
    // Windows and exotic filesystems may reject chmod; opening must still succeed.
  }

  for (const suffix of ["-wal", "-shm"] as const) {
    const sibling = `${dbPath}${suffix}`;
    if (!existsSync(sibling)) continue;
    try {
      chmodSync(sibling, 0o600);
    } catch {
      // ignore
    }
  }
}

export interface OpenDatabaseOptions {
  readonly readonly?: boolean;
  readonly create?: boolean;
  readonly wal?: boolean;
  readonly busyTimeoutMs?: number;
}

export function openKunaiDatabase(path: string, options: OpenDatabaseOptions = {}): KunaiDatabase {
  if (options.readonly !== true) {
    ensureParentDirectory(path);
  }

  const db = new Database(path, {
    readonly: options.readonly ?? false,
    create: options.create ?? true,
  });

  // `new Database` is lazy: a corrupt file opens fine and the first PRAGMA is
  // what throws. Throwing out of here with the handle still open leaves the OS
  // file handle alive until GC -- which on Windows is exactly what makes the
  // caller's recovery `renameSync` fail with EBUSY, so the corrupt file cannot
  // be quarantined and startup stays broken. Close before rethrowing.
  try {
    if (options.readonly !== true) {
      db.exec("PRAGMA foreign_keys = ON");
      db.exec(`PRAGMA busy_timeout = ${options.busyTimeoutMs ?? 5000}`);

      if (options.wal !== false) {
        db.exec("PRAGMA journal_mode = WAL");
      }

      bestEffortChmodOwnerOnly(path);
    }
  } catch (error) {
    try {
      db.close();
    } catch {
      // Already unusable; the original failure is what the caller needs.
    }
    throw error;
  }

  return db;
}

/** Cheapest statement that forces SQLite to actually read the database header. */
const CORRUPTION_PROBE_SQL = "SELECT count(*) AS n FROM sqlite_master";

export type OpenDatabaseWithRecoveryResult = {
  readonly db: KunaiDatabase;
  /** True when a corrupt database file was quarantined and a fresh one created. */
  readonly quarantinedCorruptDb: boolean;
};

/**
 * Open a database, quarantining an unreadable file instead of bricking startup.
 *
 * A corrupt `kunai-data.sqlite` (power loss, disk fault) used to throw out of
 * bootstrap on every launch with no way back in. Mirroring the JSON config
 * store's `.corrupt.bak` behavior, the unreadable file is renamed aside — never
 * deleted; it is preserved for manual recovery — and a fresh database is
 * created in its place. The caller decides how loudly to report the data loss.
 *
 * The `-wal`/`-shm` siblings do not survive: the failing handle must be closed
 * before any rename (on Windows an open handle makes `renameSync` fail with
 * EBUSY), and SQLite removes both as part of that close. Nothing is lost that
 * was recoverable — a WAL cannot be replayed without a database that opens.
 */
export function openKunaiDatabaseWithCorruptionRecovery(
  path: string,
  options: OpenDatabaseOptions = {},
  log?: (message: string) => void,
): OpenDatabaseWithRecoveryResult {
  let db: KunaiDatabase | null = null;
  try {
    db = openKunaiDatabase(path, options);
    db.query(CORRUPTION_PROBE_SQL).get();
    return { db, quarantinedCorruptDb: false };
  } catch (error) {
    try {
      db?.close();
    } catch {
      // The handle may itself be unusable; quarantine only needs the files.
    }
    const moved = quarantineCorruptDatabaseFiles(path);
    if (moved.length === 0) {
      // Nothing could be moved aside (locked file, unwritable dir) — surface
      // the original open failure instead of looping.
      throw error;
    }
    log?.(
      `Database file at ${path} was unreadable and has been quarantined to ` +
        `${moved[0]}; starting fresh. Original error: ${String(error)}`,
    );
    const reopened = openKunaiDatabase(path, options);
    reopened.query(CORRUPTION_PROBE_SQL).get();
    return { db: reopened, quarantinedCorruptDb: true };
  }
}

function quarantineCorruptDatabaseFiles(dbPath: string): string[] {
  if (dbPath === ":memory:" || dbPath.startsWith("file::memory:")) return [];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  // The main file moves first, and nothing else moves unless it did.
  //
  // Treating the siblings as independent best-effort renames loses data: on
  // Windows a locked main file fails with EBUSY while `-wal` and `-shm` move
  // aside anyway, detaching uncheckpointed history from the database it
  // belongs to. The caller then reads a non-empty result as "quarantined,
  // starting fresh" and names a WAL backup as if it were the database.
  const mainTarget = `${dbPath}.corrupt.${stamp}.bak`;
  if (!existsSync(dbPath)) return [];
  try {
    renameSync(dbPath, mainTarget);
  } catch {
    // Nothing has moved yet, so there is nothing to roll back.
    return [];
  }

  const moved = [mainTarget];
  for (const suffix of ["-wal", "-shm"] as const) {
    const source = `${dbPath}${suffix}`;
    if (!existsSync(source)) continue;
    const target = `${source}.corrupt.${stamp}.bak`;
    try {
      renameSync(source, target);
      moved.push(target);
    } catch {
      // A stale sibling next to a quarantined main file is harmless: SQLite
      // discards a -wal/-shm whose database is gone.
    }
  }
  return moved;
}
