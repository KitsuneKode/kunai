/**
 * Cost and cardinality ceilings.
 *
 * Every number here exists because something on the write path is otherwise
 * unbounded, and an unbounded write path on a maintainer-funded database is a
 * denial-of-wallet vector rather than a scaling problem. None of them changes
 * what is collected — only how much of it a single day may create.
 */

/**
 * Pings one UTC day may write before the ingest starts dropping them.
 *
 * This is the only rate limit that is possible here. Per-client limiting needs
 * a key the client cannot change: the ingest never reads an IP, and
 * `install_hash` is derived from a UUID the client mints, so a flood simply
 * mints more. A global daily ceiling is coarse and it is honest — it bounds the
 * bill without identifying anyone.
 *
 * Kunai's real traffic is a few thousand pings a day at most, and a real
 * install can only write one row per day anyway, so this leaves a large margin
 * before a legitimate ping is ever refused.
 */
export const DEFAULT_MAX_PINGS_PER_DAY = 25_000;

/**
 * Distinct buckets a rollup may store per dimension, before the tail is folded
 * into `other`.
 *
 * `version` is validated as semver, and semver is an infinite value space —
 * `1.0.0`, `1.0.1`, … and arbitrary prerelease strings all pass. Without a cap
 * a flood of invented versions becomes an unbounded number of keys inside a
 * permanent `daily_rollup.by_version` jsonb value. The public JSON already
 * folds small buckets away; this bounds what is *stored*.
 */
export const DEFAULT_MAX_BUCKETS_PER_DIMENSION = 50;

/**
 * Days an install may go silent before its `install_lifetime` row is deleted
 * and folded into the `lifetime_retired` counter.
 *
 * Longer than a year, so an install that runs even once a year is never
 * retired and the lifetime count stays exact for it. Set to `0` to disable
 * pruning and keep every row permanently, which is what the pre-hardening
 * schema did.
 */
export const DEFAULT_LIFETIME_RETENTION_DAYS = 400;

/** Positive integer or the fallback. Never throws: a typo must not 503 the ingest. */
export function readPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt((raw ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/** Non-negative integer or the fallback, so `0` can mean "disabled". */
export function readNonNegativeInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt((raw ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

export type AnalyticsLimits = {
  readonly maxPingsPerDay: number;
  readonly maxBucketsPerDimension: number;
  readonly lifetimeRetentionDays: number;
};

export const DEFAULT_ANALYTICS_LIMITS: AnalyticsLimits = {
  maxPingsPerDay: DEFAULT_MAX_PINGS_PER_DAY,
  maxBucketsPerDimension: DEFAULT_MAX_BUCKETS_PER_DIMENSION,
  lifetimeRetentionDays: DEFAULT_LIFETIME_RETENTION_DAYS,
};

export function loadAnalyticsLimits(env: Record<string, string | undefined>): AnalyticsLimits {
  return {
    maxPingsPerDay: readPositiveInt(env.ANALYTICS_MAX_PINGS_PER_DAY, DEFAULT_MAX_PINGS_PER_DAY),
    maxBucketsPerDimension: readPositiveInt(
      env.ANALYTICS_MAX_BUCKETS_PER_DIMENSION,
      DEFAULT_MAX_BUCKETS_PER_DIMENSION,
    ),
    lifetimeRetentionDays: readNonNegativeInt(
      env.ANALYTICS_LIFETIME_RETENTION_DAYS,
      DEFAULT_LIFETIME_RETENTION_DAYS,
    ),
  };
}
