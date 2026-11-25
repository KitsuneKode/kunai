import type { AnalyticsStore } from "../../src/store";

/**
 * Store methods that do nothing, for handler tests that care about a few
 * calls only. A test spreads this and overrides what it observes, so adding a
 * port method touches one file instead of every fake.
 */
export function inertStoreMethods(): Omit<
  AnalyticsStore,
  "rollUpDay" | "readRollup" | "readLatestRollupAtOrBefore" | "readRollups"
> {
  return {
    recordPing: async () => ({ admitted: true, duplicate: false }),
    findDaysNeedingRollup: async () => [],
    pruneRawBefore: async () => 0,
    pruneLifetimeBefore: async () => ({ retired: 0 }),
    rollUpMonths: async () => [],
    pruneMonthActiveBefore: async () => 0,
    readMonthRollups: async () => [],
    readCohortRollups: async () => [],
    writeDistributionSnapshot: async (_day, entries) => entries.length,
    readDistribution: async () => [],
  };
}
