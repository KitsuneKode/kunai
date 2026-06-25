import type { KunaiDatabase } from "../sqlite";

export type YoutubeMetadataCacheRecord = {
  readonly videoId: string;
  readonly payloadJson: string;
  readonly source: string;
  readonly fetchedAt: string;
  readonly expiresAt: string;
};

export class YoutubeMetadataCacheRepository {
  constructor(private readonly db: KunaiDatabase) {}

  get(videoId: string, nowIso: string): YoutubeMetadataCacheRecord | null {
    const row = this.db
      .query<YoutubeMetadataCacheRecord, [string, string]>(
        `SELECT video_id as videoId, payload_json as payloadJson, source, fetched_at as fetchedAt, expires_at as expiresAt
         FROM youtube_metadata_cache
         WHERE video_id = ? AND expires_at > ?`,
      )
      .get(videoId, nowIso);
    return row ?? null;
  }

  upsert(record: YoutubeMetadataCacheRecord): void {
    this.db
      .query(
        `INSERT INTO youtube_metadata_cache (video_id, payload_json, source, fetched_at, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(video_id) DO UPDATE SET
           payload_json = excluded.payload_json,
           source = excluded.source,
           fetched_at = excluded.fetched_at,
           expires_at = excluded.expires_at`,
      )
      .run(record.videoId, record.payloadJson, record.source, record.fetchedAt, record.expiresAt);
  }

  purgeAll(): number {
    const result = this.db.query(`DELETE FROM youtube_metadata_cache`).run();
    return result.changes ?? 0;
  }

  pruneExpired(nowIso: string): number {
    const result = this.db
      .query(`DELETE FROM youtube_metadata_cache WHERE expires_at <= ?`)
      .run(nowIso);
    return result.changes ?? 0;
  }
}
