import type { KunaiDatabase } from "../sqlite";

export type TitleProviderHealthRecord = {
  readonly titleId: string;
  readonly providerId: string;
  readonly failureCount: number;
  readonly consecutiveFailures: number;
  readonly successfulFallbackCount: number;
  readonly cleanSuccessCount: number;
  readonly suggestedProviderId?: string;
  readonly lastFailureAt?: string;
  readonly severeUntil?: string;
  readonly expiresAt: string;
  readonly updatedAt: string;
};

type TitleProviderHealthRow = { readonly health_json: string };

export class TitleProviderHealthRepository {
  constructor(private readonly db: KunaiDatabase) {}

  get(
    titleId: string,
    providerId: string,
    now = new Date(),
  ): TitleProviderHealthRecord | undefined {
    const row = this.db
      .query<TitleProviderHealthRow, [string, string]>(
        "SELECT health_json FROM title_provider_health WHERE title_id = ? AND provider_id = ?",
      )
      .get(titleId, providerId);
    if (!row) return undefined;
    const record = JSON.parse(row.health_json) as TitleProviderHealthRecord;
    if (Date.parse(record.expiresAt) <= now.getTime()) {
      this.delete(titleId, providerId);
      return undefined;
    }
    return record;
  }

  set(record: TitleProviderHealthRecord): void {
    this.db
      .query(
        `INSERT INTO title_provider_health (title_id, provider_id, health_json, expires_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(title_id, provider_id) DO UPDATE SET
           health_json = excluded.health_json,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        record.titleId,
        record.providerId,
        JSON.stringify(record),
        record.expiresAt,
        record.updatedAt,
      );
  }

  delete(titleId: string, providerId: string): void {
    this.db
      .query("DELETE FROM title_provider_health WHERE title_id = ? AND provider_id = ?")
      .run(titleId, providerId);
  }

  pruneExpired(nowIso = new Date().toISOString()): number {
    return this.db.query("DELETE FROM title_provider_health WHERE expires_at <= ?").run(nowIso)
      .changes;
  }
}
