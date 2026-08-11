import type { KunaiDatabase } from "../sqlite";

/**
 * Durable outbox for tracker pushes (AniList progress, TMDB list writes).
 *
 * Scrobbles happen at episode boundaries, which is exactly when the network is
 * least reliable — a laptop lid closing, a VPN flapping, a tracker returning
 * 502. Without a durable queue those pushes are lost and the remote list
 * silently drifts from local history forever. Rows live in the data DB (not
 * cache): losing them loses user-visible state.
 *
 * `dedupe_key` collapses repeated pushes for the same unit of progress
 * (adapter + title + episode) so re-watching an episode or a rapid retry never
 * fans out into duplicate rows.
 */
export type SyncQueueErrorKind = "network" | "auth" | "mapping" | "remote" | "unknown";

export interface SyncQueueItem {
  readonly id: string;
  readonly adapterId: string;
  readonly dedupeKey: string;
  /** Opaque adapter payload; the repository never interprets it. */
  readonly payload: unknown;
  readonly attempts: number;
  readonly nextAttemptAt: string;
  readonly lastError?: string;
  readonly lastErrorKind?: SyncQueueErrorKind;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SyncQueueEnqueueInput {
  readonly adapterId: string;
  readonly dedupeKey: string;
  readonly payload: unknown;
}

interface SyncQueueRow {
  readonly id: string;
  readonly adapter_id: string;
  readonly dedupe_key: string;
  readonly payload_json: string;
  readonly attempts: number;
  readonly next_attempt_at: string;
  readonly last_error: string | null;
  readonly last_error_kind: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const ERROR_KINDS: ReadonlySet<string> = new Set([
  "network",
  "auth",
  "mapping",
  "remote",
  "unknown",
]);

/** Retry backoff per attempt count, capped so a stuck row still retries daily. */
const BACKOFF_MS: readonly number[] = [
  60_000, // 1m
  5 * 60_000, // 5m
  30 * 60_000, // 30m
  2 * 60 * 60_000, // 2h
  12 * 60 * 60_000, // 12h
  24 * 60 * 60_000, // 24h
];

/** Attempts after which a row is considered dead and stops being retried. */
export const SYNC_QUEUE_MAX_ATTEMPTS = 8;

export function syncQueueBackoffMs(attempts: number): number {
  const index = Math.min(Math.max(attempts - 1, 0), BACKOFF_MS.length - 1);
  return BACKOFF_MS[index] ?? BACKOFF_MS[BACKOFF_MS.length - 1] ?? 60_000;
}

function mapRow(row: SyncQueueRow): SyncQueueItem {
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    payload = undefined;
  }
  const kind =
    row.last_error_kind && ERROR_KINDS.has(row.last_error_kind) ? row.last_error_kind : undefined;
  return {
    id: row.id,
    adapterId: row.adapter_id,
    dedupeKey: row.dedupe_key,
    payload,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    ...(row.last_error ? { lastError: row.last_error } : {}),
    ...(kind ? { lastErrorKind: kind as SyncQueueErrorKind } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SyncQueueRepository {
  constructor(private readonly db: KunaiDatabase) {}

  /**
   * Insert or replace the pending push for `(adapterId, dedupeKey)`.
   *
   * Replacing matters: the newest progress for an episode supersedes an older
   * queued one, and resetting `attempts` lets a fresh user action retry
   * immediately instead of inheriting a stale backoff.
   */
  enqueue(input: SyncQueueEnqueueInput, now = new Date()): void {
    const iso = now.toISOString();
    this.db
      .query(
        `
          INSERT INTO sync_queue (
            id, adapter_id, dedupe_key, payload_json, attempts, next_attempt_at,
            last_error, last_error_kind, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, 0, ?, NULL, NULL, ?, ?)
          ON CONFLICT(adapter_id, dedupe_key) DO UPDATE SET
            payload_json = excluded.payload_json,
            attempts = 0,
            next_attempt_at = excluded.next_attempt_at,
            last_error = NULL,
            last_error_kind = NULL,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        `${input.adapterId}:${input.dedupeKey}`,
        input.adapterId,
        input.dedupeKey,
        JSON.stringify(input.payload ?? null),
        iso,
        iso,
        iso,
      );
  }

  /** Rows whose backoff has elapsed and that have not exhausted their attempts. */
  listDue(limit = 25, now = new Date()): SyncQueueItem[] {
    return this.db
      .query<SyncQueueRow, [string, number, number]>(
        `
          SELECT * FROM sync_queue
          WHERE next_attempt_at <= ? AND attempts < ?
          ORDER BY next_attempt_at ASC
          LIMIT ?
        `,
      )
      .all(now.toISOString(), SYNC_QUEUE_MAX_ATTEMPTS, limit)
      .map(mapRow);
  }

  listAll(limit = 200): SyncQueueItem[] {
    return this.db
      .query<SyncQueueRow, [number]>("SELECT * FROM sync_queue ORDER BY created_at ASC LIMIT ?")
      .all(limit)
      .map(mapRow);
  }

  pendingCount(): number {
    const row = this.db
      .query<{ count: number }, [number]>(
        "SELECT COUNT(*) AS count FROM sync_queue WHERE attempts < ?",
      )
      .get(SYNC_QUEUE_MAX_ATTEMPTS);
    return row?.count ?? 0;
  }

  deadCount(): number {
    const row = this.db
      .query<{ count: number }, [number]>(
        "SELECT COUNT(*) AS count FROM sync_queue WHERE attempts >= ?",
      )
      .get(SYNC_QUEUE_MAX_ATTEMPTS);
    return row?.count ?? 0;
  }

  remove(id: string): void {
    this.db.query("DELETE FROM sync_queue WHERE id = ?").run(id);
  }

  removeForAdapter(adapterId: string): number {
    return this.db.query("DELETE FROM sync_queue WHERE adapter_id = ?").run(adapterId).changes;
  }

  /** Record a failed attempt and schedule the next one with exponential backoff. */
  recordFailure(
    id: string,
    error: string,
    kind: SyncQueueErrorKind = "unknown",
    now = new Date(),
  ): void {
    const row = this.db
      .query<{ attempts: number }, [string]>("SELECT attempts FROM sync_queue WHERE id = ?")
      .get(id);
    if (!row) return;
    const attempts = row.attempts + 1;
    const nextAttemptAt = new Date(now.getTime() + syncQueueBackoffMs(attempts)).toISOString();
    this.db
      .query(
        `
          UPDATE sync_queue
          SET attempts = ?, next_attempt_at = ?, last_error = ?, last_error_kind = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(attempts, nextAttemptAt, error.slice(0, 500), kind, now.toISOString(), id);
  }

  /** Make every row (including exhausted ones) due immediately — a manual "sync now". */
  resetAll(now = new Date()): number {
    const iso = now.toISOString();
    return this.db
      .query("UPDATE sync_queue SET attempts = 0, next_attempt_at = ?, updated_at = ?")
      .run(iso, iso).changes;
  }
}
