// =============================================================================
// watch-time-stats.ts — pure watch-time aggregation for the series-complete
// celebration. No I/O: callers pass a title's history rows; this sums them.
// Lives in domain so both the app loop (PlaybackPhase) and app-shell can use it.
// =============================================================================

import type { HistoryProgress } from "@kunai/storage";

export type WatchTimeStats = {
  readonly watchedSeconds: number;
  readonly episodeCount: number;
  readonly dayCount: number;
};

/** Pure aggregation over a title's history rows (one row per episode via upsert). */
export function aggregateWatchTime(rows: readonly HistoryProgress[]): WatchTimeStats {
  let watchedSeconds = 0;
  const days = new Set<string>();
  for (const row of rows) {
    watchedSeconds += Math.max(0, row.positionSeconds);
    days.add(row.updatedAt.slice(0, 10)); // YYYY-MM-DD
  }
  return { watchedSeconds, episodeCount: rows.length, dayCount: days.size };
}

/** Below ~10 minutes total there is nothing worth celebrating; return null to hide. */
export function formatWatchTimeSummary(stats: WatchTimeStats): string | null {
  if (stats.watchedSeconds < 600) return null;
  const hours = Math.round(stats.watchedSeconds / 3600);
  const hoursPart = hours >= 1 ? `~${hours}h` : `~${Math.round(stats.watchedSeconds / 60)}m`;
  const dayPart = `${stats.dayCount} ${stats.dayCount === 1 ? "day" : "days"}`;
  return `You watched ${hoursPart} over ${dayPart}`;
}
