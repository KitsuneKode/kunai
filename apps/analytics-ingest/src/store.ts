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

export type AnalyticsStore = {
  /** Idempotent per (day, installHash). Repeat calls are a no-op. */
  recordPing(input: RecordPingInput): Promise<void>;
  /** Compute the day's rollup from raw rows and persist it. */
  rollUpDay(day: string): Promise<DailyRollup>;
  readRollup(day: string): Promise<DailyRollup | null>;
  /** Inclusive range, ascending by day. Admin surface only. */
  readRollups(fromDay: string, toDay: string): Promise<readonly DailyRollup[]>;
  /** Deletes raw rows strictly older than `day`. Returns the row count. */
  pruneRawBefore(day: string): Promise<number>;
};

export function countBy<T>(rows: readonly T[], key: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const bucket = key(row);
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return counts;
}
