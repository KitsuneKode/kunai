import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { StorageMaintenanceService } from "@/services/persistence/StorageMaintenanceService";
import { openKunaiDatabase, runMigrations } from "@kunai/storage";

test("StorageMaintenanceService runs cache and data maintenance without throwing startup", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kunai-cli-maintenance-"));
  const diagnostics: unknown[] = [];
  try {
    const dataDb = openKunaiDatabase(join(dir, "data.sqlite"));
    const cacheDb = openKunaiDatabase(join(dir, "cache.sqlite"));
    runMigrations(dataDb, "data");
    runMigrations(cacheDb, "cache");

    cacheDb
      .query(
        `
          INSERT INTO schedule_cache (
            cache_key, payload_json, expires_at, created_at, last_accessed_at, hit_count
          )
          VALUES ('old-calendar', '{}', '2026-05-16T00:00:00.000Z', '2026-05-15T00:00:00.000Z', '2026-05-15T00:00:00.000Z', 0)
        `,
      )
      .run();

    const service = new StorageMaintenanceService({
      dataDb,
      cacheDb,
      diagnosticsStore: {
        record(event: unknown) {
          diagnostics.push(event);
        },
      },
      now: () => new Date("2026-05-17T00:00:00.000Z"),
    });

    const result = await service.runStartupMaintenance();

    expect(result.cache.pruned.scheduleCache).toBe(1);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        category: "cache",
        operation: "storage.maintenance.startup",
      }),
    );
    dataDb.close();
    cacheDb.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
