import type { KunaiDatabase } from "./sqlite";

export type MaintenanceDatabaseKind = "data" | "cache";

export interface DatabaseMaintenanceOptions {
  readonly database: MaintenanceDatabaseKind;
  readonly now?: Date;
  readonly optimize?: boolean;
  readonly checkpointWal?: boolean;
  readonly maxResolveTraces?: number;
  readonly providerHealthRetentionDays?: number;
}

export interface CacheMaintenancePruneCounts {
  readonly streamCache: number;
  readonly sourceInventory: number;
  readonly recommendationCache: number;
  readonly scheduleCache: number;
  readonly resolveTraces: number;
  readonly providerHealth: number;
  readonly titleProviderHealth: number;
  readonly releaseProgress: number;
}

export interface DatabaseMaintenanceResult {
  readonly database: MaintenanceDatabaseKind;
  readonly pruned: CacheMaintenancePruneCounts;
  readonly optimized: boolean;
  readonly checkpointed: boolean;
}

const EMPTY_PRUNE_COUNTS: CacheMaintenancePruneCounts = {
  streamCache: 0,
  sourceInventory: 0,
  recommendationCache: 0,
  scheduleCache: 0,
  resolveTraces: 0,
  providerHealth: 0,
  titleProviderHealth: 0,
  releaseProgress: 0,
};

export function runDatabaseMaintenance(
  db: KunaiDatabase,
  options: DatabaseMaintenanceOptions,
): DatabaseMaintenanceResult {
  const optimized = options.optimize !== false;
  const checkpointed = options.checkpointWal === true;
  const pruned =
    options.database === "cache"
      ? pruneCacheTables(db, {
          now: options.now ?? new Date(),
          maxResolveTraces: options.maxResolveTraces ?? 200,
          providerHealthRetentionDays: options.providerHealthRetentionDays ?? 7,
        })
      : EMPTY_PRUNE_COUNTS;

  if (optimized) {
    db.exec("PRAGMA optimize");
  }

  if (checkpointed) {
    db.exec("PRAGMA wal_checkpoint(PASSIVE)");
  }

  return {
    database: options.database,
    pruned,
    optimized,
    checkpointed,
  };
}

function pruneCacheTables(
  db: KunaiDatabase,
  options: {
    readonly now: Date;
    readonly maxResolveTraces: number;
    readonly providerHealthRetentionDays: number;
  },
): CacheMaintenancePruneCounts {
  const nowIso = options.now.toISOString();
  const staleProviderHealthBefore = new Date(
    options.now.getTime() - options.providerHealthRetentionDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const prune = db.transaction((): CacheMaintenancePruneCounts => {
    const streamCache = deleteRows(db, "DELETE FROM stream_cache WHERE expires_at <= ?", nowIso);
    const sourceInventory = deleteRows(
      db,
      "DELETE FROM source_inventory WHERE expires_at <= ?",
      nowIso,
    );
    const recommendationCache = deleteRows(
      db,
      "DELETE FROM recommendation_cache WHERE expires_at <= ?",
      nowIso,
    );
    const scheduleCache = deleteRows(
      db,
      "DELETE FROM schedule_cache WHERE expires_at <= ?",
      nowIso,
    );
    const resolveTraces = deleteRows(
      db,
      `
        DELETE FROM resolve_traces
        WHERE trace_id IN (
          SELECT trace_id
          FROM resolve_traces
          ORDER BY started_at DESC
          LIMIT -1 OFFSET ?
        )
      `,
      options.maxResolveTraces,
    );
    const providerHealth = deleteRows(
      db,
      "DELETE FROM provider_health WHERE checked_at <= ?",
      staleProviderHealthBefore,
    );
    const titleProviderHealth = deleteRows(
      db,
      "DELETE FROM title_provider_health WHERE expires_at <= ?",
      nowIso,
    );
    const releaseProgress = deleteRows(
      db,
      "DELETE FROM release_progress_cache WHERE stale_after_at <= ?",
      nowIso,
    );

    return {
      streamCache,
      sourceInventory,
      recommendationCache,
      scheduleCache,
      resolveTraces,
      providerHealth,
      titleProviderHealth,
      releaseProgress,
    };
  });

  return prune();
}

function deleteRows(db: KunaiDatabase, sql: string, value: string | number): number {
  return db.query(sql).run(value).changes;
}
