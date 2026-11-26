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
  /**
   * Installs first seen on `day`. Unlike `lifetimeInstalls` this IS exact for
   * every day the raw window can roll up: a first-seen row survives pruning
   * until its own day passes the retention window. The caveat is semantic —
   * an install returning after retirement is indistinguishable from a
   * first-ever install and counts as new on the day it returns.
   */
  readonly newInstalls: number;
  readonly byVersion: Readonly<Record<string, number>>;
  readonly byOs: Readonly<Record<string, number>>;
  readonly byArch: Readonly<Record<string, number>>;
  /**
   * Installs ever observed: live `install_lifetime` rows with `first_seen` on
   * or before `day`, plus the retired counter. Not a unique-install total —
   * an install that returns after its row was retired is counted again.
   */
  readonly lifetimeInstalls: number;
};

/** What a v2 ping adds to the shared fields. */
export type RecordPingV2Fields = {
  /** `YYYY-MM` the client's day falls in: the month its rotating id belongs to. */
  readonly activeMonth: string;
  /** `YYYY-MM` the install enabled analytics. */
  readonly cohort: string;
};

export type RecordPingInput = {
  readonly day: string;
  /** HMAC-SHA256 hex digest. Never a raw install UUID. */
  readonly installHash: string;
  readonly version: string;
  readonly os: string;
  readonly arch: string;
  /**
   * Present for a v2 ping. Absent means v1: the install's month is the
   * ingest day's, it has no cohort, and it keeps its `install_lifetime` row.
   * A v2 ping never writes `install_lifetime` — its id rotates monthly, so a
   * durable row would be one fresh "install" per month.
   */
  readonly v2?: RecordPingV2Fields;
};

/**
 * `admitted: false` means the day's global write budget was already spent, so
 * nothing was stored. The HTTP layer still answers success — telling a flood
 * where the ceiling is only helps it find the edge, and a dropped ping is not
 * a client error.
 *
 * `duplicate: true` means this install already has today's row. Nothing is
 * written and no budget is spent: admission counts distinct installs, not
 * requests, so a client retrying cannot crowd out others.
 */
export type RecordPingResult = { readonly admitted: boolean; readonly duplicate: boolean };

/** Unique active installs in one calendar month, v1 and v2 together. */
export type MonthRollup = {
  /** `YYYY-MM`. */
  readonly month: string;
  readonly activeInstalls: number;
  readonly computedAt: string;
};

/** v2 installs of one cohort that were active in one month. */
export type CohortRollup = {
  /** `YYYY-MM` the installs enabled analytics. */
  readonly cohort: string;
  /** `YYYY-MM` they were active in. `month === cohort` is the cohort's size. */
  readonly month: string;
  readonly installs: number;
  readonly computedAt: string;
};

/**
 * Where a distribution count comes from. `marker` is a GitHub release asset
 * that only exists to be counted: `install.marker` and `update.marker`.
 */
export type DistributionSource = "github" | "npm" | "marker";

/** One cumulative public download count, as read from GitHub or npm. */
export type DistributionEntry = {
  readonly source: DistributionSource;
  /** Release tag for GitHub assets; empty for npm, which counts all versions. */
  readonly release: string;
  /** `linux-x64`, `android-arm64`, …; `launcher` for the npm launcher; `install`/`update` for markers. */
  readonly platform: string;
  readonly cumulative: number;
};

export type DistributionRow = DistributionEntry & { readonly day: string };

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
   * so the published total keeps them. The fold discards identity: a returning
   * install writes a fresh row and is counted again. A no-op when retention is
   * disabled.
   */
  pruneLifetimeBefore(day: string): Promise<PruneLifetimeResult>;
  /**
   * Recompute `month_rollup` and `cohort_rollup` for every month that still
   * holds `month_active` rows, and return those months ascending. A month is
   * final once its rows are pruned; until then every run recomputes it, so a
   * missed cron run loses nothing.
   */
  rollUpMonths(): Promise<readonly string[]>;
  /** Deletes `month_active` rows for months strictly before `month` (`YYYY-MM`). */
  pruneMonthActiveBefore(month: string): Promise<number>;
  /** Inclusive `YYYY-MM` range, ascending. */
  readMonthRollups(fromMonth: string, toMonth: string): Promise<readonly MonthRollup[]>;
  /** Every cohort row with `cohort >= fromCohort`, ascending by cohort then month. */
  readCohortRollups(fromCohort: string): Promise<readonly CohortRollup[]>;
  /**
   * Replace the snapshot for `day` with `entries`, all or nothing. A partial
   * snapshot would read as every missing series dropping to zero and coming
   * back the next day as one enormous delta.
   */
  writeDistributionSnapshot(day: string, entries: readonly DistributionEntry[]): Promise<number>;
  /** Inclusive range, ascending by day. */
  readDistribution(fromDay: string, toDay: string): Promise<readonly DistributionRow[]>;
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
