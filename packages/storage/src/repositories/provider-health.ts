import { providerHealthSchema } from "@kunai/schemas";
import type { ProviderHealth, ProviderId } from "@kunai/types";

import type { KunaiDatabase } from "../sqlite";

interface ProviderHealthRow {
  readonly provider_id: string;
  readonly health_json: string;
  readonly checked_at: string;
}

export class ProviderHealthRepository {
  constructor(private readonly db: KunaiDatabase) {}

  set(health: ProviderHealth): void {
    const parsed = providerHealthSchema.parse(health);
    this.db
      .query(
        `
          INSERT INTO provider_health (provider_id, health_json, checked_at)
          VALUES (?, ?, ?)
          ON CONFLICT(provider_id) DO UPDATE SET
            health_json = excluded.health_json,
            checked_at = excluded.checked_at
        `,
      )
      .run(parsed.providerId, JSON.stringify(parsed), parsed.checkedAt);
  }

  get(providerId: ProviderId): ProviderHealth | undefined {
    const row = this.db
      .query<ProviderHealthRow, [string]>(
        "SELECT health_json FROM provider_health WHERE provider_id = ?",
      )
      .get(providerId);

    return row === null ? undefined : providerHealthSchema.parse(JSON.parse(row.health_json));
  }

  list(): ProviderHealth[] {
    const rows = this.db
      .query<ProviderHealthRow, []>(
        "SELECT provider_id, health_json, checked_at FROM provider_health ORDER BY checked_at DESC",
      )
      .all();
    return rows.map((row) => providerHealthSchema.parse(JSON.parse(row.health_json)));
  }

  delete(providerId: ProviderId): number {
    return this.db.query("DELETE FROM provider_health WHERE provider_id = ?").run(providerId)
      .changes;
  }

  deleteMany(providerIds: readonly ProviderId[]): number {
    if (providerIds.length === 0) return 0;
    let changes = 0;
    for (const providerId of providerIds) {
      changes += this.delete(providerId);
    }
    return changes;
  }

  clearAll(): number {
    return this.db.query("DELETE FROM provider_health").run().changes;
  }
}
