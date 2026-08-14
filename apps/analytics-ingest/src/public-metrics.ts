import type { DailyRollup } from "./store";

export const METRICS_SCHEMA_VERSION = 2;

/**
 * Any dimension bucket smaller than this folds into "other".
 *
 * byVersion + byOs + byArch published together identify a single user on an
 * unusual combination in a small population. That is the cost of aggregating
 * dimensions at all, and a k-anonymity floor is the standard answer to it.
 */
export const K_ANONYMITY_FLOOR = 5;

/**
 * The snapshot is rewritten once per day by cron, so a CDN may safely serve a
 * stale copy for a full day while it revalidates. Without the stale window,
 * every shared-cache expiry stampedes the origin.
 */
export const PUBLIC_METRICS_CACHE_CONTROL =
  "public, s-maxage=3600, max-age=300, stale-while-revalidate=86400";

export type PublicAnalyticsMetrics = {
  readonly schemaVersion: typeof METRICS_SCHEMA_VERSION;
  readonly day: string;
  readonly activeInstalls: number;
  readonly lifetimeInstalls: number;
  readonly byVersion: Readonly<Record<string, number>>;
  readonly byOs: Readonly<Record<string, number>>;
  readonly byArch: Readonly<Record<string, number>>;
  readonly updatedAt: string;
};

/** Totals are preserved: suppressed counts move into "other", they are not dropped. */
export function suppressSmallBuckets(
  counts: Readonly<Record<string, number>>,
  floor = K_ANONYMITY_FLOOR,
): Record<string, number> {
  const kept: Record<string, number> = {};
  let other = 0;
  for (const [bucket, count] of Object.entries(counts)) {
    if (count < floor) other += count;
    else kept[bucket] = count;
  }
  if (other > 0) kept.other = other;
  return kept;
}

export function buildPublicMetrics(rollup: DailyRollup, updatedAt: string): PublicAnalyticsMetrics {
  return {
    schemaVersion: METRICS_SCHEMA_VERSION,
    day: rollup.day,
    activeInstalls: Math.max(0, Math.floor(rollup.activeInstalls)),
    lifetimeInstalls: Math.max(0, Math.floor(rollup.lifetimeInstalls)),
    byVersion: suppressSmallBuckets(rollup.byVersion),
    byOs: suppressSmallBuckets(rollup.byOs),
    byArch: suppressSmallBuckets(rollup.byArch),
    updatedAt,
  };
}

const PUBLIC_METRICS_KEYS = [
  "activeInstalls",
  "byArch",
  "byOs",
  "byVersion",
  "day",
  "lifetimeInstalls",
  "schemaVersion",
  "updatedAt",
] as const;

function isCountMap(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(
    (count) => typeof count === "number" && Number.isFinite(count) && count >= 0,
  );
}

export function parsePublicMetrics(raw: unknown): PublicAnalyticsMetrics | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== PUBLIC_METRICS_KEYS.length) return null;
  for (let i = 0; i < PUBLIC_METRICS_KEYS.length; i += 1) {
    if (keys[i] !== PUBLIC_METRICS_KEYS[i]) return null;
  }
  if (record.schemaVersion !== METRICS_SCHEMA_VERSION) return null;
  if (typeof record.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(record.day)) return null;
  if (
    typeof record.activeInstalls !== "number" ||
    !Number.isFinite(record.activeInstalls) ||
    record.activeInstalls < 0
  ) {
    return null;
  }
  if (
    typeof record.lifetimeInstalls !== "number" ||
    !Number.isFinite(record.lifetimeInstalls) ||
    record.lifetimeInstalls < 0
  ) {
    return null;
  }
  if (!isCountMap(record.byVersion)) return null;
  if (!isCountMap(record.byOs)) return null;
  if (!isCountMap(record.byArch)) return null;
  if (typeof record.updatedAt !== "string" || !record.updatedAt) return null;
  return {
    schemaVersion: METRICS_SCHEMA_VERSION,
    day: record.day,
    activeInstalls: Math.floor(record.activeInstalls),
    lifetimeInstalls: Math.floor(record.lifetimeInstalls),
    byVersion: record.byVersion,
    byOs: record.byOs,
    byArch: record.byArch,
    updatedAt: record.updatedAt,
  };
}

/** Prefer yesterday's rollup for the public "active installs" line. */
export function snapshotDayKey(now = Date.now()): string {
  return new Date(now - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
