/**
 * Profile inspector — one read-only way to ask "what did the run actually
 * persist?" Used by BOTH driver layers (in-process AppRoot sessions and the
 * tmux-driven real binary) and by `agent:drive`, so there is a single source
 * of truth for backend state. It deliberately reads the SQLite files and
 * config.json BY PATH rather than going through a live container's
 * repositories: two ways to ask the same question drift, and the inspector is
 * the oracle scenarios assert against.
 *
 * Deferred writes are a real hazard (debounced progress saves, outbox
 * flushes): callers must first `waitForFrame` on the UI state that implies the
 * write completed, then inspect. The inspector reports committed state, never
 * pending intent.
 */
import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";

export type ProfileStoragePaths = {
  readonly dataDbPath: string;
  readonly cacheDbPath: string;
  readonly configPath: string;
};

export type HistoryRow = {
  title_id: string;
  media_kind: string;
  season: number | null;
  episode: number | null;
  absolute_episode: number | null;
};

export type QueueRow = {
  id: string;
  title_id: string;
  absolute_episode: number | null;
  status: string;
  last_failure_json: string | null;
};

/** Canonical JSON for one row — sorted keys so equal rows serialize equal. */
function canonicalRow(row: unknown): string {
  return JSON.stringify(row, Object.keys(row as Record<string, unknown>).sort());
}

/**
 * Full state of one SQLite file: `tableName -> sorted canonical rows`.
 * Bounded per table — a pathological table is truncated, not fatal, and the
 * truncation is reported in `truncated` so a diff on a capped table is never
 * mistaken for complete truth.
 */
export type DbFileSnapshot = {
  readonly tables: Map<string, string[]>;
  readonly truncated: readonly string[];
};

/** Snapshots of both databases, keyed `"data.<table>"` / `"cache.<table>"`. */
export type ProfileSnapshot = Map<string, string[]>;

export type TableDelta = {
  readonly added: readonly string[];
  readonly removed: readonly string[];
};

/** `table -> {added, removed}` for tables whose contents differ. */
export type ProfileDelta = Map<string, TableDelta>;

export interface ProfileInspector {
  history(): HistoryRow[];
  queue(): QueueRow[];
  /** Parsed config.json; `{}` when absent (fresh profile). */
  config(): Record<string, unknown>;
  /** `table -> row count` across both databases. */
  tables(): Record<string, number>;
  /** Raw rows of one table (canonical JSON strings), `"data.x"`/`"cache.x"` keyed. */
  tableRows(table: string): readonly string[];
  /** Multiset snapshot of every table in both DBs. */
  snapshot(): ProfileSnapshot;
}

const TABLE_ROW_CAP = 10_000;

function snapshotFile(dbPath: string): DbFileSnapshot {
  const tables = new Map<string, string[]>();
  const truncated: string[] = [];
  if (!existsSync(dbPath)) return { tables, truncated };

  const db = new Database(dbPath, { readonly: true });
  try {
    const names = db
      .query(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all() as Array<{ name: string }>;
    for (const { name } of names) {
      const rows = db
        .query(`SELECT * FROM "${name.replace(/"/g, '""')}" LIMIT ${TABLE_ROW_CAP + 1}`)
        .all();
      if (rows.length > TABLE_ROW_CAP) truncated.push(name);
      const canonical = rows.slice(0, TABLE_ROW_CAP).map(canonicalRow);
      canonical.sort();
      tables.set(name, canonical);
    }
  } finally {
    db.close();
  }
  return { tables, truncated };
}

export function snapshotProfile(paths: ProfileStoragePaths): ProfileSnapshot {
  const out: ProfileSnapshot = new Map();
  for (const [prefix, dbPath] of [
    ["data", paths.dataDbPath],
    ["cache", paths.cacheDbPath],
  ] as const) {
    const snap = snapshotFile(dbPath);
    for (const [table, rows] of snap.tables) {
      out.set(`${prefix}.${table}`, rows);
    }
  }
  return out;
}

function multisetDelta(before: readonly string[], after: readonly string[]): TableDelta {
  const remaining = new Map<string, number>();
  for (const row of before) remaining.set(row, (remaining.get(row) ?? 0) + 1);
  const added: string[] = [];
  for (const row of after) {
    const count = remaining.get(row) ?? 0;
    if (count > 0) remaining.set(row, count - 1);
    else added.push(row);
  }
  const removed: string[] = [];
  for (const [row, count] of remaining) {
    for (let i = 0; i < count; i++) removed.push(row);
  }
  return { added, removed };
}

/** Diff two snapshots. A row edit shows as one removal + one addition — honest. */
export function diffSnapshots(before: ProfileSnapshot, after: ProfileSnapshot): ProfileDelta {
  const delta: ProfileDelta = new Map();
  const tables = new Set([...before.keys(), ...after.keys()]);
  for (const table of tables) {
    const d = multisetDelta(before.get(table) ?? [], after.get(table) ?? []);
    if (d.added.length > 0 || d.removed.length > 0) delta.set(table, d);
  }
  return delta;
}

export function createProfileInspector(paths: ProfileStoragePaths): ProfileInspector {
  return {
    history() {
      const db = openDataDb(paths.dataDbPath);
      try {
        return historyRows(db);
      } finally {
        db.close();
      }
    },
    queue() {
      const db = openDataDb(paths.dataDbPath);
      try {
        return queueRows(db);
      } finally {
        db.close();
      }
    },
    config() {
      if (!existsSync(paths.configPath)) return {};
      try {
        return JSON.parse(readFileSync(paths.configPath, "utf8")) as Record<string, unknown>;
      } catch {
        // A torn write is a finding, not a crash — report what we could see.
        return { __unreadable: true };
      }
    },
    tables() {
      const snap = snapshotProfile(paths);
      const out: Record<string, number> = {};
      for (const [table, rows] of snap) out[table] = rows.length;
      return out;
    },
    tableRows(table) {
      const [prefix, ...rest] = table.split(".");
      const dbPath = prefix === "cache" ? paths.cacheDbPath : paths.dataDbPath;
      const name = rest.join(".");
      if (!existsSync(dbPath)) return [];
      const db = new Database(dbPath, { readonly: true });
      try {
        return db
          .query(`SELECT * FROM "${name.replace(/"/g, '""')}" LIMIT ${TABLE_ROW_CAP}`)
          .all()
          .map(canonicalRow);
      } finally {
        db.close();
      }
    },
    snapshot() {
      return snapshotProfile(paths);
    },
  };
}

// ---------------------------------------------------------------------------
// Shared openers — the canonical home of these moved from
// integration/helpers/compiled-binary-harness.ts (which re-exports them).
// ---------------------------------------------------------------------------

export function openDataDb(path: string): Database {
  return new Database(path, { readonly: true });
}

export function historyRows(db: Database): HistoryRow[] {
  return db
    .query(
      `SELECT title_id, media_kind, season, episode, absolute_episode
       FROM history_progress
       ORDER BY updated_at DESC`,
    )
    .all() as HistoryRow[];
}

export function queueRows(db: Database): QueueRow[] {
  return db
    .query(
      `SELECT id, title_id, absolute_episode, status, last_failure_json
       FROM playlist_queue
       ORDER BY queue_position ASC, added_at ASC`,
    )
    .all() as QueueRow[];
}
