import type { KunaiDatabase } from "../sqlite";
import { getExpiresAt, isExpired } from "../ttl";

interface ProviderTitleBridgeRow {
  readonly native_id: string;
  readonly expires_at: string;
}

export class ProviderTitleBridgeRepository {
  constructor(private readonly db: KunaiDatabase) {}

  get(
    providerId: string,
    catalogKind: string,
    catalogId: string,
    now = new Date(),
  ): string | undefined {
    const row = this.db
      .query<ProviderTitleBridgeRow, [string, string, string]>(
        `
          SELECT native_id, expires_at
          FROM provider_title_bridge
          WHERE provider_id = ? AND catalog_kind = ? AND catalog_id = ?
        `,
      )
      .get(providerId, catalogKind, catalogId);
    if (row === null) return undefined;
    if (isExpired(row.expires_at, now)) {
      this.delete(providerId, catalogKind, catalogId);
      return undefined;
    }
    return row.native_id;
  }

  set(
    providerId: string,
    catalogKind: string,
    catalogId: string,
    nativeId: string,
    now = new Date(),
  ): void {
    const trimmed = nativeId.replace(/^allanime:/, "").trim();
    if (!trimmed) return;
    const updatedAt = now.toISOString();
    const expiresAt = getExpiresAt("provider-metadata", now);
    this.db
      .query(
        `
          INSERT INTO provider_title_bridge (
            provider_id,
            catalog_kind,
            catalog_id,
            native_id,
            expires_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(provider_id, catalog_kind, catalog_id) DO UPDATE SET
            native_id = excluded.native_id,
            expires_at = excluded.expires_at,
            updated_at = excluded.updated_at
        `,
      )
      .run(providerId, catalogKind, catalogId, trimmed, expiresAt, updatedAt);
  }

  delete(providerId: string, catalogKind: string, catalogId: string): void {
    this.db
      .query(
        "DELETE FROM provider_title_bridge WHERE provider_id = ? AND catalog_kind = ? AND catalog_id = ?",
      )
      .run(providerId, catalogKind, catalogId);
  }
}
