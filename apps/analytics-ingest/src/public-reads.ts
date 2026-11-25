/**
 * Store reads shared by the public monthly, distribution and badge endpoints,
 * so a badge and the JSON it summarises can never read different windows.
 */

import { shiftDayKey } from "./analytics-day.js";
import { monthOfDay } from "./ingest.js";
import {
  buildPublicDistribution,
  DISTRIBUTION_WINDOW_DAYS,
  type PublicDistribution,
} from "./public-distribution.js";
import {
  buildPublicMonthly,
  PUBLISHED_MONTHS,
  shiftMonth,
  type PublicMonthly,
} from "./public-monthly.js";
import type { AnalyticsStore, MonthRollup } from "./store.js";

/**
 * The window plus the snapshot before it, so the window's first day still has
 * a predecessor to take its delta from.
 */
export async function loadPublicDistribution(
  store: AnalyticsStore,
  today: string,
): Promise<PublicDistribution | null> {
  const rows = await store.readDistribution(shiftDayKey(today, -DISTRIBUTION_WINDOW_DAYS), today);
  return buildPublicDistribution(rows);
}

export async function loadPublicMonthly(
  store: AnalyticsStore,
  today: string,
): Promise<PublicMonthly | null> {
  const currentMonth = monthOfDay(today);
  const fromMonth = shiftMonth(currentMonth, -PUBLISHED_MONTHS);
  const [months, cohorts] = await Promise.all([
    store.readMonthRollups(fromMonth, shiftMonth(currentMonth, -1)),
    store.readCohortRollups(fromMonth),
  ]);
  return buildPublicMonthly(months, cohorts, currentMonth);
}

/** The month before `today`'s: the newest one that has finished. */
export async function loadLastCompleteMonth(
  store: AnalyticsStore,
  today: string,
): Promise<MonthRollup | null> {
  const previous = shiftMonth(monthOfDay(today), -1);
  const rows = await store.readMonthRollups(previous, previous);
  return rows[0] ?? null;
}
