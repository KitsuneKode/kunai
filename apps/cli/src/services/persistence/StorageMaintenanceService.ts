import {
  runDatabaseMaintenance,
  type DatabaseMaintenanceResult,
  type KunaiDatabase,
} from "@kunai/storage";

import type { DiagnosticsService } from "../diagnostics/DiagnosticsService";

export type StorageMaintenanceResult = {
  readonly data: DatabaseMaintenanceResult;
  readonly cache: DatabaseMaintenanceResult;
};

export class StorageMaintenanceService {
  constructor(
    private readonly deps: {
      readonly dataDb: KunaiDatabase;
      readonly cacheDb: KunaiDatabase;
      readonly diagnostics?: Pick<DiagnosticsService, "record">;
      readonly now?: () => Date;
    },
  ) {}

  async runStartupMaintenance(): Promise<StorageMaintenanceResult> {
    const now = this.deps.now?.() ?? new Date();
    const data = runDatabaseMaintenance(this.deps.dataDb, {
      database: "data",
      now,
      optimize: true,
      checkpointWal: false,
    });
    const cache = runDatabaseMaintenance(this.deps.cacheDb, {
      database: "cache",
      now,
      optimize: true,
      checkpointWal: false,
    });
    const result = { data, cache };

    this.deps.diagnostics?.record({
      category: "cache",
      operation: "storage.maintenance.startup",
      message: "Storage maintenance completed",
      context: {
        cachePruned: cache.pruned,
        dataOptimized: data.optimized,
        cacheOptimized: cache.optimized,
      },
    });

    return result;
  }
}
