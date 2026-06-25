import type { KunaiDatabase } from "@kunai/storage";

export type HistoryWatchLedgerBackfillStats = {
  readonly rowsUpdated: number;
};

/**
 * One-time backfill for migration 024 columns on existing history_progress rows.
 * Best-effort: completed rows get duration as watched_seconds; partial rows get
 * MIN(position, duration).
 */
export function runHistoryWatchLedgerBackfill(db: KunaiDatabase): HistoryWatchLedgerBackfillStats {
  db.exec(`
    UPDATE history_progress
    SET
      watched_seconds = CASE
        WHEN completed = 1 AND duration_seconds IS NOT NULL AND duration_seconds > 0
          THEN duration_seconds
        WHEN duration_seconds IS NOT NULL AND duration_seconds > 0
          THEN MIN(position_seconds, duration_seconds)
        ELSE position_seconds
      END,
      last_watched_at = COALESCE(last_watched_at, updated_at),
      completed_at = CASE
        WHEN completed = 1 THEN COALESCE(completed_at, updated_at)
        ELSE completed_at
      END
    WHERE watched_seconds = 0 OR last_watched_at IS NULL
  `);
  const row = db.query<{ count: number }, []>("SELECT changes() AS count").get();
  return { rowsUpdated: row?.count ?? 0 };
}
