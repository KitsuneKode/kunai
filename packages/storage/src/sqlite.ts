import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
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

  if (options.readonly !== true) {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(`PRAGMA busy_timeout = ${options.busyTimeoutMs ?? 5000}`);

    if (options.wal !== false) {
      db.exec("PRAGMA journal_mode = WAL");
    }

    bestEffortChmodOwnerOnly(path);
  }

  return db;
}
