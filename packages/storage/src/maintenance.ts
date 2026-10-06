import type { KunaiDatabase } from "./sqlite";

export type MaintenanceDatabaseKind = "data" | "cache";

export interface DatabaseMaintenanceOptions {
  readonly database: MaintenanceDatabaseKind;
  readonly now?: Date;
  readonly optimize?: boolean;
  readonly checkpointWal?: boolean;
  readonly maxResolveTraces?: number;
  readonly maxDiagnosticEvents?: number;
  readonly diagnosticRetentionDays?: number;
  readonly providerHealthRetentionDays?: number;
  readonly notificationRetentionDays?: number;
  readonly maxNotifications?: number;
  readonly maxNotificationSuppressions?: number;
}

export interface CacheMaintenancePruneCounts {
  readonly streamCache: number;
  readonly sourceInventory: number;
  readonly recommendationCache: number;
  readonly scheduleCache: number;
  readonly youtubeMetadataCache: number;
  readonly catalogCrosswalk: number;
  readonly providerCache: number;
  readonly resolveTraces: number;
  readonly providerHealth: number;
  readonly titleProviderHealth: number;
  readonly providerEndpointHealth: number;
  readonly releaseProgress: number;
  readonly diagnosticEvents: number;
}

export interface DataMaintenancePruneCounts {
  readonly notifications: number;
  readonly notificationSuppressions: number;
}

export interface DatabaseMaintenanceResult {
  readonly database: MaintenanceDatabaseKind;
  readonly pruned: CacheMaintenancePruneCounts;
  readonly dataPruned: DataMaintenancePruneCounts;
  readonly optimized: boolean;
  readonly checkpointed: boolean;
}

const EMPTY_PRUNE_COUNTS: CacheMaintenancePruneCounts = {
  streamCache: 0,
  sourceInventory: 0,
  recommendationCache: 0,
  scheduleCache: 0,
  youtubeMetadataCache: 0,
  catalogCrosswalk: 0,
  providerCache: 0,
  resolveTraces: 0,
  providerHealth: 0,
  titleProviderHealth: 0,
  providerEndpointHealth: 0,
  releaseProgress: 0,
  diagnosticEvents: 0,
};

const EMPTY_DATA_PRUNE_COUNTS: DataMaintenancePruneCounts = {
  notifications: 0,
  notificationSuppressions: 0,
};

export function runDatabaseMaintenance(
  db: KunaiDatabase,
  options: DatabaseMaintenanceOptions,
): DatabaseMaintenanceResult {
  const optimized = options.optimize !== false;
  const checkpointed = options.checkpointWal === true;
  const now = options.now ?? new Date();
  const pruned =
    options.database === "cache"
      ? pruneCacheTables(db, {
          now,
          maxResolveTraces: options.maxResolveTraces ?? 200,
          maxDiagnosticEvents: options.maxDiagnosticEvents ?? 10_000,
          diagnosticRetentionDays: options.diagnosticRetentionDays ?? 14,
          providerHealthRetentionDays: options.providerHealthRetentionDays ?? 7,
        })
      : EMPTY_PRUNE_COUNTS;
  const dataPruned =
    options.database === "data"
      ? pruneDataTables(db, {
          now,
          notificationRetentionDays: options.notificationRetentionDays ?? 90,
          maxNotifications: options.maxNotifications ?? 500,
          maxNotificationSuppressions: options.maxNotificationSuppressions ?? 5_000,
        })
      : EMPTY_DATA_PRUNE_COUNTS;

  if (optimized) {
    db.exec("PRAGMA optimize");
  }

  if (checkpointed) {
    db.exec("PRAGMA wal_checkpoint(PASSIVE)");
  }

  return {
    database: options.database,
    pruned,
    dataPruned,
    optimized,
    checkpointed,
  };
}

function pruneCacheTables(
  db: KunaiDatabase,
  options: {
    readonly now: Date;
    readonly maxResolveTraces: number;
    readonly maxDiagnosticEvents: number;
    readonly diagnosticRetentionDays: number;
    readonly providerHealthRetentionDays: number;
  },
): CacheMaintenancePruneCounts {
  const nowIso = options.now.toISOString();
  const staleDiagnosticBefore =
    options.now.getTime() - options.diagnosticRetentionDays * 24 * 60 * 60 * 1000;
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
    const youtubeMetadataCache = deleteRows(
      db,
      "DELETE FROM youtube_metadata_cache WHERE expires_at <= ?",
      nowIso,
    );
    // The crosswalk treats expired rows as misses on read; without this sweep
    // they were never deleted anywhere, so the table grew for the life of the
    // cache DB.
    const catalogCrosswalk = deleteRows(
      db,
      "DELETE FROM catalog_id_crosswalk WHERE expires_at <= ?",
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
    // The provider cache treats expired rows as misses on read; without this
    // sweep a large episode catalog (One Piece is ~9MB) would linger past its
    // TTL for the life of the cache DB.
    const providerCache = deleteRows(
      db,
      "DELETE FROM provider_cache WHERE expires_at <= ?",
      nowIso,
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
    const providerEndpointHealth = deleteRows(
      db,
      `
        DELETE FROM provider_endpoint_health
        WHERE quarantined_until IS NOT NULL AND quarantined_until <= ?
      `,
      nowIso,
    );
    const releaseProgress = deleteRows(
      db,
      "DELETE FROM release_progress_cache WHERE stale_after_at <= ?",
      nowIso,
    );
    const staleDiagnosticEvents = deleteRows(
      db,
      "DELETE FROM diagnostic_events WHERE timestamp < ?",
      staleDiagnosticBefore,
    );
    const overflowDiagnosticEvents = deleteRows(
      db,
      `
        DELETE FROM diagnostic_events
        WHERE id IN (
          SELECT id
          FROM diagnostic_events
          ORDER BY timestamp DESC, id DESC
          LIMIT -1 OFFSET ?
        )
      `,
      options.maxDiagnosticEvents,
    );

    return {
      streamCache,
      sourceInventory,
      recommendationCache,
      scheduleCache,
      youtubeMetadataCache,
      catalogCrosswalk,
      providerCache,
      resolveTraces,
      providerHealth,
      titleProviderHealth,
      providerEndpointHealth,
      releaseProgress,
      diagnosticEvents: staleDiagnosticEvents + overflowDiagnosticEvents,
    };
  });

  return prune();
}

/**
 * Data-DB retention. Notifications accrue one row per distinct dedup key and
 * nothing ever swept them — a long-lived profile grew the table forever, and
 * `listAllActive`/`listAllArchived` read it unbounded. The same applies to
 * `notification_suppressions`.
 *
 * Deleting a row without tombstoning its dedup key would let the next
 * `recordSignals` pass resurrect it, so every pruned key is written into
 * `notification_suppressions` first — the same contract `clearArchived` and
 * `deleteByDedupKey` already use.
 */
function pruneDataTables(
  db: KunaiDatabase,
  options: {
    readonly now: Date;
    readonly notificationRetentionDays: number;
    readonly maxNotifications: number;
    readonly maxNotificationSuppressions: number;
  },
): DataMaintenancePruneCounts {
  const nowIso = options.now.toISOString();
  const staleBefore = new Date(
    options.now.getTime() - options.notificationRetentionDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const prune = db.transaction((): DataMaintenancePruneCounts => {
    // Stale rows the user has already resolved — read, dismissed, or archived —
    // are the safe retention cut. Active unread rows are left alone by age and
    // only trimmed by the hard ceiling below.
    const tombstoneStale = db
      .query(
        `INSERT INTO notification_suppressions (dedup_key, suppressed_at)
         SELECT dedup_key, ? FROM notifications
         WHERE (read_at IS NOT NULL OR dismissed_at IS NOT NULL OR archived_at IS NOT NULL)
           AND updated_at <= ?
         ON CONFLICT(dedup_key) DO NOTHING`,
      )
      .run(nowIso, staleBefore);
    const staleNotifications = db
      .query(
        `DELETE FROM notifications
         WHERE (read_at IS NOT NULL OR dismissed_at IS NOT NULL OR archived_at IS NOT NULL)
           AND updated_at <= ?`,
      )
      .run(staleBefore).changes;

    db.query(
      `INSERT INTO notification_suppressions (dedup_key, suppressed_at)
       SELECT dedup_key, ? FROM notifications
       WHERE dedup_key IN (
         SELECT dedup_key FROM notifications
         ORDER BY updated_at DESC
         LIMIT -1 OFFSET ?
       )
       ON CONFLICT(dedup_key) DO NOTHING`,
    ).run(nowIso, options.maxNotifications);
    const overflowNotifications = db
      .query(
        `DELETE FROM notifications
         WHERE dedup_key IN (
           SELECT dedup_key FROM notifications
           ORDER BY updated_at DESC
           LIMIT -1 OFFSET ?
         )`,
      )
      .run(options.maxNotifications).changes;

    const notificationSuppressions = db
      .query(
        `DELETE FROM notification_suppressions
         WHERE dedup_key IN (
           SELECT dedup_key FROM notification_suppressions
           ORDER BY suppressed_at DESC
           LIMIT -1 OFFSET ?
         )`,
      )
      .run(options.maxNotificationSuppressions).changes;

    void tombstoneStale;
    return {
      notifications: staleNotifications + overflowNotifications,
      notificationSuppressions,
    };
  });

  return prune();
}

function deleteRows(db: KunaiDatabase, sql: string, value: string | number): number {
  return db.query(sql).run(value).changes;
}
