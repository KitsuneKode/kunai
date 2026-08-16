import type { MediaKind, ProviderExternalIds } from "@kunai/types";

import type { KunaiDatabase } from "../sqlite";

export type SyncReconciliationPayload =
  | {
      readonly kind: "history";
      readonly historyKey: string;
      /** Tracker-neutral revision proving this exact local write was observed. */
      readonly localMutationId: string;
    }
  | {
      readonly kind: "list";
      readonly list: "watchlist" | "favorites";
      readonly present: boolean;
      readonly item: {
        readonly titleId: string;
        readonly mediaKind: MediaKind;
        readonly title: string;
        readonly season?: number;
        readonly episode?: number;
        readonly externalIds?: ProviderExternalIds;
      };
    };

export interface SyncReconciliationRecord {
  readonly id: string;
  readonly generation: number;
  readonly attempts: number;
  readonly nextAttemptAt: string;
  readonly kind: SyncReconciliationPayload["kind"];
  readonly entityKey: string;
  readonly payload: SyncReconciliationPayload;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface SyncReconciliationRow {
  readonly id: string;
  readonly generation: number;
  readonly attempt_count: number;
  readonly next_attempt_at: string;
  readonly mutation_kind: SyncReconciliationPayload["kind"];
  readonly entity_key: string;
  readonly payload_json: string;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * Durable local facts awaiting consent/identity-aware tracker projection.
 * These rows never name a tracker and are safe to create in the transaction
 * that commits the user's local mutation.
 */
export class SyncReconciliationRepository {
  constructor(private readonly db: KunaiDatabase) {}

  record(payload: SyncReconciliationPayload, now = new Date()): SyncReconciliationRecord {
    const entityKey =
      payload.kind === "history" ? payload.historyKey : `${payload.list}:${payload.item.titleId}`;
    const nowIso = now.toISOString();
    this.db
      .query(
        `INSERT INTO sync_reconciliation (
           id, mutation_kind, entity_key, payload_json, generation,
           attempt_count, next_attempt_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 1, 0, ?, ?, ?)
         ON CONFLICT(mutation_kind, entity_key) DO UPDATE SET
           payload_json = excluded.payload_json,
           generation = CASE
             WHEN sync_reconciliation.payload_json != excluded.payload_json
             THEN sync_reconciliation.generation + 1
             ELSE sync_reconciliation.generation
           END,
           attempt_count = CASE
             WHEN sync_reconciliation.payload_json != excluded.payload_json THEN 0
             ELSE sync_reconciliation.attempt_count
           END,
           next_attempt_at = CASE
             WHEN sync_reconciliation.payload_json != excluded.payload_json
             THEN excluded.next_attempt_at
             ELSE sync_reconciliation.next_attempt_at
           END,
           updated_at = excluded.updated_at`,
      )
      .run(
        crypto.randomUUID(),
        payload.kind,
        entityKey,
        JSON.stringify(payload),
        nowIso,
        nowIso,
        nowIso,
      );
    const stored = this.get(payload.kind, entityKey);
    if (!stored) throw new Error(`Sync reconciliation row missing after record: ${entityKey}`);
    return stored;
  }

  listPending(limit = 100): readonly SyncReconciliationRecord[] {
    return this.db
      .query<SyncReconciliationRow, [number]>(
        `SELECT * FROM sync_reconciliation
         ORDER BY created_at ASC, id ASC
         LIMIT ?`,
      )
      .all(Math.max(0, Math.trunc(limit)))
      .map(mapRow);
  }

  listDue(now = new Date(), limit = 100): readonly SyncReconciliationRecord[] {
    return this.db
      .query<SyncReconciliationRow, [string, number]>(
        `SELECT * FROM sync_reconciliation
         WHERE next_attempt_at <= ?
         ORDER BY next_attempt_at ASC, created_at ASC, id ASC
         LIMIT ?`,
      )
      .all(now.toISOString(), Math.max(0, Math.trunc(limit)))
      .map(mapRow);
  }

  nextAttemptAt(): string | undefined {
    return this.db
      .query<{ readonly next_attempt_at: string }, []>(
        `SELECT next_attempt_at
         FROM sync_reconciliation
         ORDER BY next_attempt_at ASC
         LIMIT 1`,
      )
      .get()?.next_attempt_at;
  }

  getById(id: string): SyncReconciliationRecord | undefined {
    const row = this.db
      .query<SyncReconciliationRow, [string]>("SELECT * FROM sync_reconciliation WHERE id = ?")
      .get(id);
    return row ? mapRow(row) : undefined;
  }

  complete(record: Pick<SyncReconciliationRecord, "id" | "generation">): boolean {
    return (
      this.db
        .query("DELETE FROM sync_reconciliation WHERE id = ? AND generation = ?")
        .run(record.id, record.generation).changes > 0
    );
  }

  defer(
    record: Pick<SyncReconciliationRecord, "id" | "generation" | "attempts">,
    now = new Date(),
  ): boolean {
    const delayMs = Math.min(5 * 60_000, 1_000 * 2 ** Math.min(record.attempts, 8));
    const nextAttemptAt = new Date(now.getTime() + delayMs).toISOString();
    return (
      this.db
        .query(
          `UPDATE sync_reconciliation
           SET attempt_count = attempt_count + 1,
               next_attempt_at = ?,
               updated_at = ?
           WHERE id = ? AND generation = ?`,
        )
        .run(nextAttemptAt, now.toISOString(), record.id, record.generation).changes > 0
    );
  }

  private get(
    kind: SyncReconciliationPayload["kind"],
    entityKey: string,
  ): SyncReconciliationRecord | undefined {
    const row = this.db
      .query<SyncReconciliationRow, [string, string]>(
        "SELECT * FROM sync_reconciliation WHERE mutation_kind = ? AND entity_key = ?",
      )
      .get(kind, entityKey);
    return row ? mapRow(row) : undefined;
  }
}

function mapRow(row: SyncReconciliationRow): SyncReconciliationRecord {
  return {
    id: row.id,
    generation: row.generation,
    attempts: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    kind: row.mutation_kind,
    entityKey: row.entity_key,
    payload: JSON.parse(row.payload_json) as SyncReconciliationPayload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
