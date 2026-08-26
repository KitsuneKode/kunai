/**
 * The published day-by-day series.
 *
 * `daily_rollup` is never pruned — retention only removes `ping_day` and
 * `install_lifetime` — so the aggregate history is already on disk. This module
 * decides how much of it is safe to publish, and answers a question the daily
 * snapshot cannot: does a release actually propagate?
 *
 * No new collection, no payload change, no consent change. Serving only.
 */

import {
  DIMENSION_VALUE_SPACE,
  METRICS_SCHEMA_VERSION,
  OTHER_BUCKET,
  SMALL_CELL_FLOOR,
  sealResidual,
} from "./public-metrics.js";
import type { DailyRollup } from "./store.js";

/** Longest window the endpoint will serve, in days. */
export const MAX_SERIES_DAYS = 180;

/** Window served when the caller does not ask for one. */
export const DEFAULT_SERIES_DAYS = 90;

export type PublicSeriesPoint = {
  readonly day: string;
  readonly activeInstalls: number;
  readonly lifetimeInstalls: number;
  readonly byVersion: Readonly<Record<string, number>>;
  readonly byOs: Readonly<Record<string, number>>;
  readonly byArch: Readonly<Record<string, number>>;
};

export type PublicAnalyticsSeries = {
  readonly schemaVersion: typeof METRICS_SCHEMA_VERSION;
  readonly from: string;
  readonly to: string;
  readonly points: readonly PublicSeriesPoint[];
  readonly updatedAt: string;
};

/**
 * Which buckets of one dimension may be published across the whole window.
 *
 * Suppressing per-day would make a bucket sitting near the floor blink in and
 * out, and the blink is itself a signal about a small population — the snapshot
 * leaks "this bucket was under five" once, a per-day series leaks it on every
 * boundary crossing. So a bucket that is ever under the floor is folded into
 * `other` for every day of the window.
 *
 * A day where the bucket is simply absent does not disqualify it. A version
 * that did not exist yet is not a small cell, and counting absence as zero
 * would hide every new release — which is the one thing this series exists to
 * show.
 */
export function windowPublishableBuckets(
  perDay: readonly Readonly<Record<string, number>>[],
  floor: number = SMALL_CELL_FLOOR,
): ReadonlySet<string> {
  const seen = new Set<string>();
  const disqualified = new Set<string>();

  for (const day of perDay) {
    for (const [bucket, count] of Object.entries(day)) {
      // A stored `other` is already a residual, never a publishable value.
      if (bucket === OTHER_BUCKET) continue;
      seen.add(bucket);
      if (count < floor) disqualified.add(bucket);
    }
  }

  const publishable = new Set<string>();
  for (const bucket of seen) {
    if (!disqualified.has(bucket)) publishable.add(bucket);
  }
  return publishable;
}

/** Apply a window-wide keep set to one day, then seal the residual. */
function suppressDay(
  counts: Readonly<Record<string, number>>,
  publishable: ReadonlySet<string>,
  valueSpace: number,
): Record<string, number> {
  const kept: Record<string, number> = {};
  let other = 0;
  for (const [bucket, count] of Object.entries(counts)) {
    if (bucket !== OTHER_BUCKET && publishable.has(bucket)) kept[bucket] = count;
    else other += count;
  }
  return sealResidual(kept, other, valueSpace);
}

/**
 * Build the published series. Input order does not matter — it is sorted here.
 *
 * `updatedAt` reports the newest `computedAt` in the window, matching the
 * snapshot's staleness signal.
 */
export function buildPublicSeries(rollups: readonly DailyRollup[]): PublicAnalyticsSeries | null {
  if (rollups.length === 0) return null;

  // Sorted here rather than trusted from the caller. Both stores already order
  // by day, but `from`/`to` and the published point order are read straight off
  // the ends of this array — a caller that ever stopped sorting would publish a
  // window whose bounds silently disagree with its contents.
  const ordered = [...rollups].sort((a, b) => a.day.localeCompare(b.day));

  const versionKeep = windowPublishableBuckets(ordered.map((r) => r.byVersion));
  const osKeep = windowPublishableBuckets(ordered.map((r) => r.byOs));
  const archKeep = windowPublishableBuckets(ordered.map((r) => r.byArch));

  const points = ordered.map((rollup) => ({
    day: rollup.day,
    activeInstalls: Math.max(0, Math.floor(rollup.activeInstalls)),
    lifetimeInstalls: Math.max(0, Math.floor(rollup.lifetimeInstalls)),
    byVersion: suppressDay(rollup.byVersion, versionKeep, DIMENSION_VALUE_SPACE.version),
    byOs: suppressDay(rollup.byOs, osKeep, DIMENSION_VALUE_SPACE.os),
    byArch: suppressDay(rollup.byArch, archKeep, DIMENSION_VALUE_SPACE.arch),
  }));

  const updatedAt = ordered.reduce(
    (newest, rollup) => (rollup.computedAt > newest ? rollup.computedAt : newest),
    ordered[0]?.computedAt ?? "",
  );

  return {
    schemaVersion: METRICS_SCHEMA_VERSION,
    from: points[0]?.day ?? "",
    to: points.at(-1)?.day ?? "",
    points,
    updatedAt,
  };
}

/** Clamp a caller-supplied `days` query to the window this endpoint will serve. */
export function clampSeriesDays(raw: string | undefined): number {
  const parsed = Number.parseInt((raw ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SERIES_DAYS;
  return Math.min(parsed, MAX_SERIES_DAYS);
}

/** The inclusive start day for a window of `days` ending on `endDay`. */
export function seriesStartDay(endDay: string, days: number): string {
  const end = new Date(`${endDay}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() - (days - 1));
  return end.toISOString().slice(0, 10);
}
