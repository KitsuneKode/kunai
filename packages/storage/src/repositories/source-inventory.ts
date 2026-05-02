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

    return {
      inventoryKey: row.inventory_key,
      providerId: row.provider_id,
      titleId: row.title_id,
      inventory: JSON.parse(row.inventory_json) as TInventory,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      lastAccessedAt: accessedAt,
    };
  }

  delete(inventoryKey: string): void {
    this.db.query("DELETE FROM source_inventory WHERE inventory_key = ?").run(inventoryKey);
  }
}
