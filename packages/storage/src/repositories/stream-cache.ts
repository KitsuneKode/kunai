import { streamCandidateSchema } from "@kunai/schemas";
import type { StreamCandidate } from "@kunai/types";

import type { KunaiDatabase } from "../sqlite";
import { isExpired } from "../ttl";

export interface StreamCacheEntry {
  readonly cacheKey: string;
  readonly stream: StreamCandidate;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly lastAccessedAt: string;
  readonly hitCount: number;
}

interface StreamCacheRow {
  readonly cache_key: string;
  readonly stream_json: string;
  readonly expires_at: string;
  readonly created_at: string;
  readonly last_accessed_at: string;
  readonly hit_count: number;
}

export class StreamCacheRepository {
  constructor(private readonly db: KunaiDatabase) {}

  set(
    cacheKey: string,
    stream: StreamCandidate,
    expiresAt: string,
    now = new Date().toISOString(),
  ): void {
    const parsed = streamCandidateSchema.parse(stream);

    this.db
      .query(
        `
          INSERT INTO stream_cache (
            cache_key,
            schema_version,
            provider_id,
            stream_json,
            expires_at,
            created_at,
            last_accessed_at,
            hit_count
          )
          VALUES (?, 1, ?, ?, ?, ?, ?, 0)
          ON CONFLICT(cache_key) DO UPDATE SET
            schema_version = 1,
            provider_id = excluded.provider_id,
            stream_json = excluded.stream_json,
            expires_at = excluded.expires_at,
            last_accessed_at = excluded.last_accessed_at
        `,
      )
      .run(cacheKey, parsed.providerId, JSON.stringify(parsed), expiresAt, now, now);
  }

  get(cacheKey: string, now = new Date()): StreamCacheEntry | undefined {
    const row = this.db
      .query<StreamCacheRow, [string]>("SELECT * FROM stream_cache WHERE cache_key = ?")
      .get(cacheKey);

    if (row === null) {
      return undefined;
    }

    if (isExpired(row.expires_at, now)) {
      this.delete(cacheKey);
      return undefined;
    }

    const accessedAt = now.toISOString();
    this.db
      .query(
        "UPDATE stream_cache SET last_accessed_at = ?, hit_count = hit_count + 1 WHERE cache_key = ?",
      )
      .run(accessedAt, cacheKey);

    return {
      cacheKey: row.cache_key,
      stream: streamCandidateSchema.parse(JSON.parse(row.stream_json)),
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      lastAccessedAt: accessedAt,
      hitCount: row.hit_count + 1,
    };
  }

  delete(cacheKey: string): void {
    this.db.query("DELETE FROM stream_cache WHERE cache_key = ?").run(cacheKey);
  }

  clear(): void {
    this.db.query("DELETE FROM stream_cache").run();
  }

  pruneExpired(now = new Date()): number {
    const result = this.db
      .query("DELETE FROM stream_cache WHERE expires_at <= ?")
      .run(now.toISOString());
    return result.changes;
  }
}
