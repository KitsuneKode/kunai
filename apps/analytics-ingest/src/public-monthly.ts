/**
 * Monthly actives, new installs per month, and cohort retention.
 *
 * Built from `month_rollup` and `cohort_rollup`, which hold counts only. Only
 * complete months are published: a partial month changes every day, and a
 * figure that steps daily is a differencing channel the per-day series was
 * already designed to avoid.
 *
 * Cohorts exist only for v2 clients, so `newInstalls` and retention count v2
 * installs alone. `activeInstalls` counts v1 and v2 together.
 */

import { SMALL_CELL_FLOOR } from "./public-metrics.js";
import type { CohortRollup, MonthRollup } from "./store.js";

export const MONTHLY_SCHEMA_VERSION = 1;

/** A cohort smaller than this publishes no retention cell at all. */
export const RETENTION_MIN_COHORT_SIZE = 10;

/** M1…M6. M0 is the cohort's size, published as `newInstalls`. */
export const MAX_RETENTION_OFFSET = 6;

/** Months of history the endpoint publishes. */
export const PUBLISHED_MONTHS = 12;

export type PublicMonth = {
  readonly month: string;
  /** Unique active installs in the month; null when under the small-cell floor. */
  readonly activeInstalls: number | null;
};

export type PublicRetentionCell = {
  /** Months after the cohort month: 1 is M1. */
  readonly offset: number;
  /** Cohort installs active that month; null when suppressed. */
  readonly installs: number | null;
};

export type PublicCohort = {
  readonly cohort: string;
  /** The cohort's size: v2 installs that enabled analytics this month and pinged in it. */
  readonly newInstalls: number | null;
  readonly retained: readonly PublicRetentionCell[];
};

export type PublicMonthly = {
  readonly schemaVersion: typeof MONTHLY_SCHEMA_VERSION;
  /** The newest complete month the document covers. */
  readonly throughMonth: string;
  readonly months: readonly PublicMonth[];
  readonly cohorts: readonly PublicCohort[];
  readonly updatedAt: string;
};

/** Shift a `YYYY-MM` label by whole months. Pure arithmetic; reads no clock. */
export function shiftMonth(month: string, months: number): string {
  const [year = 0, mon = 1] = month.split("-").map(Number);
  const index = year * 12 + (mon - 1) + months;
  const shiftedYear = Math.floor(index / 12);
  const shiftedMonth = (index % 12) + 1;
  return `${String(shiftedYear).padStart(4, "0")}-${String(shiftedMonth).padStart(2, "0")}`;
}

/** A plain count under the small-cell floor is suppressed. */
export function floorCount(count: number): number | null {
  return count >= SMALL_CELL_FLOOR ? count : null;
}

/**
 * A retention cell is published only when both it and its complement are at
 * least the floor, inside a cohort large enough to have both.
 *
 * `retained >= 5` alone is not enough: publishing `retained` next to the
 * cohort size also publishes `size - retained`, the installs that left, and a
 * cohort of 12 with 9 retained says "three left" as plainly as a cell of 3.
 */
export function isRetentionCellPublishable(cohortSize: number, retained: number): boolean {
  return (
    cohortSize >= RETENTION_MIN_COHORT_SIZE &&
    retained >= SMALL_CELL_FLOOR &&
    retained <= cohortSize - SMALL_CELL_FLOOR
  );
}

/**
 * Build the public document for every complete month before `currentMonth`.
 * Null when no complete month has a rollup yet.
 */
export function buildPublicMonthly(
  monthRollups: readonly MonthRollup[],
  cohortRollups: readonly CohortRollup[],
  currentMonth: string,
): PublicMonthly | null {
  const throughMonth = shiftMonth(currentMonth, -1);
  const fromMonth = shiftMonth(currentMonth, -PUBLISHED_MONTHS);
  const inWindow = (month: string) => month >= fromMonth && month <= throughMonth;

  const months = monthRollups
    .filter((rollup) => inWindow(rollup.month))
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((rollup) => ({ month: rollup.month, activeInstalls: floorCount(rollup.activeInstalls) }));

  const installsAt = new Map<string, number>();
  for (const row of cohortRollups) installsAt.set(`${row.cohort}::${row.month}`, row.installs);

  const cohortMonths = [...new Set(cohortRollups.map((row) => row.cohort))].filter(inWindow).sort();
  const cohorts = cohortMonths.map((cohort) => {
    const size = installsAt.get(`${cohort}::${cohort}`) ?? 0;
    const retained: PublicRetentionCell[] = [];
    for (let offset = 1; offset <= MAX_RETENTION_OFFSET; offset += 1) {
      const month = shiftMonth(cohort, offset);
      // A month that has not finished has no retention figure yet.
      if (month > throughMonth) break;
      const installs = installsAt.get(`${cohort}::${month}`) ?? 0;
      retained.push({
        offset,
        installs: isRetentionCellPublishable(size, installs) ? installs : null,
      });
    }
    return { cohort, newInstalls: floorCount(size), retained };
  });

  if (months.length === 0 && cohorts.length === 0) return null;

  const stamps = [...monthRollups, ...cohortRollups].map((row) => row.computedAt);
  return {
    schemaVersion: MONTHLY_SCHEMA_VERSION,
    throughMonth,
    months,
    cohorts,
    updatedAt: stamps.reduce((newest, stamp) => (stamp > newest ? stamp : newest), ""),
  };
}
