import { providerHealthSchema } from "@kunai/schemas";
import type { ProviderHealth, ProviderId } from "@kunai/types";

import type { KunaiDatabase } from "../sqlite";

interface ProviderHealthRow {
  readonly health_json: string;
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

  clearAll(): number {
    return this.db.query("DELETE FROM provider_health").run().changes;
  }
}
