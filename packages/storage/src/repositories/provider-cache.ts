import type { KunaiDatabase } from "../sqlite";
import { isExpired } from "../ttl";

interface ProviderCacheRow {
  readonly payload_json: string;
  readonly expires_at: string;
}

/**
 * Generic per-provider key/value cache backing `ProviderCachePort`.
 *
 * Providers own no storage, so this is how a provider's expensive, stable
 * intermediate data (a Cloudflare-gated episode catalog) survives a restart.
 * Keys are scoped by `namespace` so two providers cannot collide.
 */
export class ProviderCacheRepository {
  constructor(private readonly db: KunaiDatabase) {}

  read(namespace: string, cacheKey: string, now = new Date()): string | null {
    const row = this.db
      .query<ProviderCacheRow, [string, string]>(
        "SELECT payload_json, expires_at FROM provider_cache WHERE namespace = ? AND cache_key = ?",
      )
      .get(namespace, cacheKey);
    if (!row) return null;
    if (isExpired(row.expires_at, now)) {
      // Delete only if this exact expired row still stands: another process may
      // have refreshed it between this read and the delete, and dropping that
      // fresh value would reintroduce the cold cost we are avoiding.
      this.db
        .query(
          "DELETE FROM provider_cache WHERE namespace = ? AND cache_key = ? AND expires_at = ?",
        )
        .run(namespace, cacheKey, row.expires_at);
      return null;
    }
    return row.payload_json;
  }

  write(
    namespace: string,
    cacheKey: string,
    payloadJson: string,
    expiresAt: string,
    now = new Date().toISOString(),
  ): void {
    this.db
      .query(
        `INSERT INTO provider_cache (namespace, cache_key, payload_json, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(namespace, cache_key) DO UPDATE SET
           payload_json = excluded.payload_json,
           expires_at = excluded.expires_at,
           created_at = excluded.created_at`,
      )
      .run(namespace, cacheKey, payloadJson, expiresAt, now);
  }

  delete(namespace: string, cacheKey: string): void {
    this.db
      .query("DELETE FROM provider_cache WHERE namespace = ? AND cache_key = ?")
      .run(namespace, cacheKey);
  }

  pruneExpired(now = new Date().toISOString()): void {
    this.db.query("DELETE FROM provider_cache WHERE expires_at <= ?").run(now);
  }
}
