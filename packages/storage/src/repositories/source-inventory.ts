import { isJsonObject, isJsonString } from "@kunai/types";

import type { KunaiDatabase } from "../sqlite";
import { isExpired } from "../ttl";

export interface SourceInventoryEntry<TInventory = unknown> {
  readonly inventoryKey: string;
  readonly providerId: string;
  readonly titleId: string;
  readonly inventory: TInventory;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly lastAccessedAt: string;
}

interface SourceInventoryRow {
  readonly inventory_key: string;
  readonly provider_id: string;
  readonly title_id: string;
  readonly inventory_json: string;
  readonly expires_at: string;
  readonly created_at: string;
  readonly last_accessed_at: string;
}

export class SourceInventoryRepository {
  constructor(private readonly db: KunaiDatabase) {}

  set<TInventory>(
    inventoryKey: string,
    providerId: string,
    titleId: string,
    inventory: TInventory,
    expiresAt: string,
    now = new Date().toISOString(),
  ): void {
    this.db
      .query(
        `
          INSERT INTO source_inventory (
            inventory_key,
            provider_id,
            title_id,
            inventory_json,
            expires_at,
            created_at,
            last_accessed_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(inventory_key) DO UPDATE SET
            provider_id = excluded.provider_id,
            title_id = excluded.title_id,
            inventory_json = excluded.inventory_json,
            expires_at = excluded.expires_at,
            last_accessed_at = excluded.last_accessed_at
        `,
      )
      .run(inventoryKey, providerId, titleId, JSON.stringify(inventory), expiresAt, now, now);
  }

  get<TInventory = unknown>(
    inventoryKey: string,
    now = new Date(),
  ): SourceInventoryEntry<TInventory> | undefined {
    const row = this.db
      .query<SourceInventoryRow, [string]>("SELECT * FROM source_inventory WHERE inventory_key = ?")
      .get(inventoryKey);

    if (row === null) {
      return undefined;
    }

    if (isExpired(row.expires_at, now)) {
      this.delete(inventoryKey);
      return undefined;
    }

    const accessedAt = now.toISOString();
    this.db
      .query("UPDATE source_inventory SET last_accessed_at = ? WHERE inventory_key = ?")
      .run(accessedAt, inventoryKey);

    // Same contract as stream-cache reads: a row whose inventory shape is
    // corrupt is not a hit — throw so the service layer records it as a cache
    // failure instead of handing garbage downstream. The repository is generic,
    // so the check is structural: the fields consumers read must be arrays of
    // objects with string ids when they exist at all.
    const parsed: unknown = JSON.parse(row.inventory_json);
    if (!isSourceInventoryRecord(parsed)) {
      throw new Error(`invalid source_inventory row for ${row.inventory_key}`);
    }

    return {
      inventoryKey: row.inventory_key,
      providerId: row.provider_id,
      titleId: row.title_id,
      // SAFETY: rows are validated by the inventory shape check before this cast runs.
      inventory: parsed as TInventory,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      lastAccessedAt: accessedAt,
    };
  }

  delete(inventoryKey: string): void {
    this.db.query("DELETE FROM source_inventory WHERE inventory_key = ?").run(inventoryKey);
  }

  deleteByProvider(providerId: string): number {
    const result = this.db
      .query("DELETE FROM source_inventory WHERE provider_id = ?")
      .run(providerId);
    return result.changes ?? 0;
  }
}

/**
 * The narrow structure downstream actually reads: an object whose `streams`,
 * `sources`, `variants`, and `subtitles` — when present — are arrays, and
 * whose stream urls, when present, are strings. Looser than a schema on
 * purpose: the repository is generic over the stored payload.
 */
function isSourceInventoryRecord<T>(value: T): boolean {
  if (!isJsonObject(value)) return false;
  for (const key of ["streams", "sources", "variants", "subtitles"] as const) {
    const field = value[key];
    if (field !== undefined && !Array.isArray(field)) return false;
    if (key === "streams" && Array.isArray(field)) {
      for (const stream of field) {
        if (!isJsonObject(stream)) return false;
        const url = stream.url;
        if (url !== undefined && !isJsonString(url)) return false;
      }
    }
  }
  return true;
}
