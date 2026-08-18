/**
 * One port. The four it replaces (RateLimitStore, InstallDayGate,
 * DailyDistinctStore, LifetimeStore) were Redis data structures wearing
 * domain names — a TTL key, a SET, and a HyperLogLog. Postgres needs one
 * table and one upsert, so it needs one port.
 */

export type DailyRollup = {
  readonly day: string;
  /** Persisted cron completion time; public `updatedAt` must report this value. */
  readonly computedAt: string;
  readonly activeInstalls: number;
  readonly byVersion: Readonly<Record<string, number>>;
  readonly byOs: Readonly<Record<string, number>>;
  readonly byArch: Readonly<Record<string, number>>;
  readonly lifetimeInstalls: number;
};

export type RecordPingInput = {
  readonly day: string;
  /** HMAC-SHA256 hex digest. Never a raw install UUID. */
  readonly installHash: string;
  readonly version: string;
  readonly os: string;
  readonly arch: string;
};

/**
 * `admitted: false` means the day's global write budget was already spent, so
 * nothing was stored. The HTTP layer still answers success — telling a flood
 * where the ceiling is only helps it find the edge, and a dropped ping is not
 * a client error.
 */
export type RecordPingResult = { readonly admitted: boolean };

/** What the retention sweep removed. Reported by the cron for operator visibility. */
export type PruneLifetimeResult = { readonly retired: number };

export type AnalyticsStore = {
  /**
   * Idempotent per (day, installHash). Repeat calls are a no-op, and calls past
   * the day's admission budget are dropped.
   */
  recordPing(input: RecordPingInput): Promise<RecordPingResult>;
  /** Compute the day's rollup from raw rows and persist it. */
  rollUpDay(day: string): Promise<DailyRollup>;
  readRollup(day: string): Promise<DailyRollup | null>;
  /**
   * Newest rollup on or before `day`. A public endpoint must be able to serve a
   * visibly stale snapshot rather than 404 forever once cron falls behind.
   */
  readLatestRollupAtOrBefore(day: string): Promise<DailyRollup | null>;
  /** Inclusive range, ascending by day. Admin surface only. */
  readRollups(fromDay: string, toDay: string): Promise<readonly DailyRollup[]>;
  /**
   * Days in the inclusive range that still hold raw rows but have no rollup.
   * A cron run that only ever handles yesterday loses any day it missed, for
   * good, once retention deletes the raw rows behind it.
   */
  findDaysNeedingRollup(fromDay: string, toDay: string): Promise<readonly string[]>;
  /** Deletes raw rows strictly older than `day`. Returns the row count. */
  pruneRawBefore(day: string): Promise<number>;
  /**
   * Deletes install rows unseen since `day`, adding them to the retired counter
   * so the lifetime total stays exact. A no-op when retention is disabled.
   */
  pruneLifetimeBefore(day: string): Promise<PruneLifetimeResult>;
};

export function countBy<T>(rows: readonly T[], key: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const bucket = key(row);
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return counts;
}

/**
 * Keep the `limit` largest buckets and fold the rest into `other`.
 *
 * Bounds a stored dimension against an open value space — `version` is any
 * valid semver, so a hostile client can invent as many buckets as it likes and
 * each one becomes a permanent key in `daily_rollup.by_version`. Ties break on
 * the bucket name so a rollup recomputed for the same day is identical.
 */
export function capBuckets(
  counts: Readonly<Record<string, number>>,
  limit: number,
): Record<string, number> {
  const entries = Object.entries(counts);
  if (entries.length <= limit) return { ...counts };

  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const kept: Record<string, number> = {};
  let other = 0;
  for (const [bucket, count] of entries.slice(0, limit)) kept[bucket] = count;
  for (const [, count] of entries.slice(limit)) other += count;
  if (other > 0) kept.other = (kept.other ?? 0) + other;
  return kept;
}
