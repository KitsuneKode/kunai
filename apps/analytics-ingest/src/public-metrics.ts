import { ALLOWED_ARCH, ALLOWED_OS } from "./payload-validation.js";
import type { DailyRollup } from "./store.js";

export const METRICS_SCHEMA_VERSION = 2;

/**
 * Any dimension bucket smaller than this folds into "other".
 *
 * byVersion + byOs + byArch published together identify a single user on an
 * unusual combination in a small population. That is the cost of publishing
 * separate aggregates. This is small-cell suppression, not joint anonymity.
 */
export const SMALL_CELL_FLOOR = 5;

/** The residual bucket. Never a real dimension value — `os`/`arch` are allowlisted. */
export const OTHER_BUCKET = "other";

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

/**
 * How many values a dimension can take. `other` hides nothing once every value
 * but one is published as its own bucket.
 *
 * `version` is an open space — any semver — so elimination never closes on it.
 */
export const DIMENSION_VALUE_SPACE = {
  version: Number.POSITIVE_INFINITY,
  os: ALLOWED_OS.length,
  arch: ALLOWED_ARCH.length,
} as const;

/**
 * Totals are preserved: suppressed counts move into "other", they are not
 * dropped. `activeInstalls` is published alongside, so `other` is always
 * recoverable by subtraction anyway — folding hides *which* bucket, never how
 * many installs are unaccounted for.
 *
 * Which is exactly why folding alone is not enough on a closed dimension. With
 * `arch` taking two values, `{ x64: 8, other: 1 }` says "one arm64 install" in
 * as many words: the reader eliminates the published bucket and one candidate
 * remains. `os` has the same hole once two of its three values are published.
 *
 * So after folding, while fewer than two candidate values could account for
 * `other`, the smallest surviving bucket is folded in as well until at least
 * two could. The total still holds, the dimension still publishes its shape
 * where it safely can, and no bucket is recoverable by elimination.
 */
export function suppressSmallBuckets(
  counts: Readonly<Record<string, number>>,
  floor = SMALL_CELL_FLOOR,
  valueSpace = Number.POSITIVE_INFINITY,
): Record<string, number> {
  const kept: Record<string, number> = {};
  let other = 0;
  for (const [bucket, count] of Object.entries(counts)) {
    // A stored `other` is already a residual — the rollup's bucket cap folds a
    // long tail into it — so it merges rather than surviving as a named bucket.
    if (bucket === OTHER_BUCKET || count < floor) other += count;
    else kept[bucket] = count;
  }

  return sealResidual(kept, other, valueSpace);
}

/**
 * Fold surviving buckets into `other` until it can no longer be attributed by
 * elimination, then attach it.
 *
 * Shared by the snapshot and the series so both close the same hole: with a
 * closed dimension, publishing every value but one makes `other` that value.
 */
export function sealResidual(
  kept: Record<string, number>,
  residual: number,
  valueSpace: number,
): Record<string, number> {
  let other = residual;
  // Only a non-empty `other` can be attributed by elimination.
  while (other > 0 && valueSpace - Object.keys(kept).length < 2) {
    const smallest = Object.entries(kept).sort(
      (a, b) => a[1] - b[1] || a[0].localeCompare(b[0]),
    )[0];
    if (!smallest) break;
    other += smallest[1];
    delete kept[smallest[0]];
  }

  if (other > 0) kept[OTHER_BUCKET] = other;
  return kept;
}

export function buildPublicMetrics(rollup: DailyRollup): PublicAnalyticsMetrics {
  return {
    schemaVersion: METRICS_SCHEMA_VERSION,
    day: rollup.day,
    activeInstalls: Math.max(0, Math.floor(rollup.activeInstalls)),
    lifetimeInstalls: Math.max(0, Math.floor(rollup.lifetimeInstalls)),
    byVersion: suppressSmallBuckets(
      rollup.byVersion,
      SMALL_CELL_FLOOR,
      DIMENSION_VALUE_SPACE.version,
    ),
    byOs: suppressSmallBuckets(rollup.byOs, SMALL_CELL_FLOOR, DIMENSION_VALUE_SPACE.os),
    byArch: suppressSmallBuckets(rollup.byArch, SMALL_CELL_FLOOR, DIMENSION_VALUE_SPACE.arch),
    updatedAt: rollup.computedAt,
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
