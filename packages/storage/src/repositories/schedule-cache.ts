import type { KunaiDatabase } from "../sqlite";
import { isExpired } from "../ttl";

export interface ScheduleCacheEntry {
  readonly cacheKey: string;
  readonly payloadJson: string;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly lastAccessedAt: string;
  readonly hitCount: number;
}

export type ScheduleCacheSetOptions = {
  readonly expiresAt: string;
  readonly now?: string;
  readonly source?: string;
  readonly mode?: string;
};

interface ScheduleCacheRow {
  readonly cache_key: string;
  readonly payload_json: string;
  readonly expires_at: string;
  readonly created_at: string;
  readonly last_accessed_at: string;
  readonly hit_count: number;
}

export class ScheduleCacheRepository {
  constructor(private readonly db: KunaiDatabase) {}

  set(cacheKey: string, payloadJson: string, options: ScheduleCacheSetOptions): void {
    const now = options.now ?? new Date().toISOString();
    this.db
      .query(
        `
          INSERT INTO schedule_cache (
            cache_key,
            source,
            mode,
            payload_json,
            expires_at,
            created_at,
            last_accessed_at,
            hit_count
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, 0)
          ON CONFLICT(cache_key) DO UPDATE SET
            source = excluded.source,
            mode = excluded.mode,
            payload_json = excluded.payload_json,
            expires_at = excluded.expires_at,
            last_accessed_at = excluded.last_accessed_at
        `,
      )
      .run(
        cacheKey,
        options.source ?? null,
        options.mode ?? null,
        payloadJson,
        options.expiresAt,
        now,
        now,
      );
  }

  get(cacheKey: string, now = new Date()): ScheduleCacheEntry | undefined {
    const row = this.db
      .query<ScheduleCacheRow, [string]>("SELECT * FROM schedule_cache WHERE cache_key = ?")
      .get(cacheKey);
    if (row === null) return undefined;
    if (isExpired(row.expires_at, now)) {
      this.db
        .query("DELETE FROM schedule_cache WHERE cache_key = ? AND expires_at = ?")
        .run(cacheKey, row.expires_at);
      return undefined;
    }

    const accessedAt = now.toISOString();
    this.db
      .query(
        "UPDATE schedule_cache SET last_accessed_at = ?, hit_count = hit_count + 1 WHERE cache_key = ?",
      )
      .run(accessedAt, cacheKey);

    return {
      cacheKey: row.cache_key,
      payloadJson: row.payload_json,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      lastAccessedAt: accessedAt,
      hitCount: row.hit_count + 1,
    };
  }

  delete(cacheKey: string): void {
    this.db.query("DELETE FROM schedule_cache WHERE cache_key = ?").run(cacheKey);
  }

  clear(): void {
    this.db.query("DELETE FROM schedule_cache").run();
  }

  pruneExpired(now = new Date()): number {
    const result = this.db
      .query("DELETE FROM schedule_cache WHERE expires_at <= ?")
      .run(now.toISOString());
    return result.changes;
  }
}
