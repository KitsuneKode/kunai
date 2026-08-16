import type { MediaKind, ProviderExternalIds } from "@kunai/types";

import type { KunaiDatabase } from "../sqlite";

export type SyncReconciliationPayload =
  | { readonly kind: "history"; readonly historyKey: string }
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
  readonly kind: SyncReconciliationPayload["kind"];
  readonly entityKey: string;
  readonly payload: SyncReconciliationPayload;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface SyncReconciliationRow {
  readonly id: string;
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
           id, mutation_kind, entity_key, payload_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(mutation_kind, entity_key) DO UPDATE SET
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`,
      )
      .run(crypto.randomUUID(), payload.kind, entityKey, JSON.stringify(payload), nowIso, nowIso);
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

  complete(id: string): boolean {
    return this.db.query("DELETE FROM sync_reconciliation WHERE id = ?").run(id).changes > 0;
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
    kind: row.mutation_kind,
    entityKey: row.entity_key,
    payload: JSON.parse(row.payload_json) as SyncReconciliationPayload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
