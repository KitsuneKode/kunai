import { providerEndpointHealthSchema } from "@kunai/schemas";
import type { ProviderEndpointHealthRecord, ProviderId } from "@kunai/types";

import type { KunaiDatabase } from "../sqlite";

interface ProviderEndpointHealthRow {
  readonly provider_id: string;
  readonly endpoint: string;
  readonly health_json: string;
  readonly quarantined_until: string | null;
  readonly updated_at: string;
}

export class ProviderEndpointHealthRepository {
  constructor(private readonly db: KunaiDatabase) {}

  set(record: ProviderEndpointHealthRecord): void {
    const parsed = providerEndpointHealthSchema.parse(record);
    this.db
      .query(
        `
          INSERT INTO provider_endpoint_health (
            provider_id,
            endpoint,
            health_json,
            quarantined_until,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(provider_id, endpoint) DO UPDATE SET
            health_json = excluded.health_json,
            quarantined_until = excluded.quarantined_until,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        parsed.providerId,
        parsed.endpoint,
        JSON.stringify(parsed),
        parsed.quarantinedUntil ?? null,
        parsed.updatedAt,
      );
  }

  get(providerId: ProviderId, endpoint: string): ProviderEndpointHealthRecord | undefined {
    const row = this.db
      .query<ProviderEndpointHealthRow, [string, string]>(
        `
          SELECT health_json
          FROM provider_endpoint_health
          WHERE provider_id = ? AND endpoint = ?
        `,
      )
      .get(providerId, endpoint);

    return row === null
      ? undefined
      : providerEndpointHealthSchema.parse(JSON.parse(row.health_json));
  }

  list(): ProviderEndpointHealthRecord[] {
    const rows = this.db
      .query<ProviderEndpointHealthRow, []>(
        `
          SELECT provider_id, endpoint, health_json, quarantined_until, updated_at
          FROM provider_endpoint_health
          ORDER BY updated_at DESC
        `,
      )
      .all();
    return rows.map((row) => providerEndpointHealthSchema.parse(JSON.parse(row.health_json)));
  }

  isQuarantined(providerId: ProviderId, endpoint: string, nowIso: string): boolean {
    const row = this.db
      .query<{ readonly quarantined_until: string | null }, [string, string]>(
        `
          SELECT quarantined_until
          FROM provider_endpoint_health
          WHERE provider_id = ? AND endpoint = ?
        `,
      )
      .get(providerId, endpoint);

    if (row === null || row.quarantined_until === null) {
      return false;
    }

    return Date.parse(row.quarantined_until) > Date.parse(nowIso);
  }

  delete(providerId: ProviderId, endpoint: string): number {
    return this.db
      .query("DELETE FROM provider_endpoint_health WHERE provider_id = ? AND endpoint = ?")
      .run(providerId, endpoint).changes;
  }

  deleteExpiredQuarantines(nowIso: string): number {
    return this.db
      .query(
        `
          DELETE FROM provider_endpoint_health
          WHERE quarantined_until IS NOT NULL AND quarantined_until <= ?
        `,
      )
      .run(nowIso).changes;
  }

  clearAll(): number {
    return this.db.query("DELETE FROM provider_endpoint_health").run().changes;
  }
}
