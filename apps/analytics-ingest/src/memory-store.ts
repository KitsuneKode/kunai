import { DEFAULT_ANALYTICS_LIMITS, type AnalyticsLimits } from "./limits.js";
import {
  capBuckets,
  countBy,
  type AnalyticsStore,
  type CohortRollup,
  type DailyRollup,
  type DistributionRow,
  type MonthRollup,
  type RecordPingInput,
} from "./store.js";

type MonthActive = { readonly month: string; readonly cohort: string | null };

/** In-process test double. Mirrors the Postgres semantics, including idempotency. */
export function createMemoryAnalyticsStore(
  limits: AnalyticsLimits = DEFAULT_ANALYTICS_LIMITS,
): AnalyticsStore & {
  readonly rawCount: () => number;
  readonly lifetimeCount: () => number;
  readonly monthActiveCount: () => number;
  /** Every mutation `recordPing` has made, so a test can prove a request wrote nothing. */
  readonly pingWrites: () => number;
  readonly budgetSpent: (day: string) => number;
} {
  const raw = new Map<string, RecordPingInput>();
  /** installHash → { firstSeen, lastSeen }, mirroring install_lifetime. */
  const lifetime = new Map<string, { firstSeen: string; lastSeen: string }>();
  const rollups = new Map<string, DailyRollup>();
  const budget = new Map<string, number>();
  /** `${month}::${hash}`, mirroring month_active. */
  const monthActive = new Map<string, MonthActive>();
  const monthRollups = new Map<string, MonthRollup>();
  const cohortRollups = new Map<string, CohortRollup>();
  const distribution = new Map<string, DistributionRow>();
  let retired = 0;
  let pingWrites = 0;

  const keyOf = (day: string, hash: string) => `${day}::${hash}`;

  return {
    async recordPing(input) {
      const key = keyOf(input.day, input.installHash);
      // A repeat ping is answered without touching anything, budget included.
      if (raw.has(key)) return { admitted: true, duplicate: true };
      const spent = budget.get(input.day) ?? 0;
      // Over budget is a read, never a write: the counter stops at the ceiling.
      if (spent >= limits.maxPingsPerDay) return { admitted: false, duplicate: false };

      budget.set(input.day, spent + 1);
      raw.set(key, input);
      pingWrites += 2;

      if (!input.v2) {
        const seen = lifetime.get(input.installHash);
        if (!seen) lifetime.set(input.installHash, { firstSeen: input.day, lastSeen: input.day });
        else if (seen.lastSeen < input.day) seen.lastSeen = input.day;
        pingWrites += 1;
      }

      const month = input.v2?.activeMonth ?? input.day.slice(0, 7);
      const monthKey = keyOf(month, input.installHash);
      if (!monthActive.has(monthKey)) {
        monthActive.set(monthKey, { month, cohort: input.v2?.cohort ?? null });
        pingWrites += 1;
      }
      return { admitted: true, duplicate: false };
    },
    async rollUpDay(day) {
      const rows = [...raw.values()].filter((row) => row.day === day);
      const cap = limits.maxBucketsPerDimension;
      const rollup: DailyRollup = {
        day,
        computedAt: new Date().toISOString(),
        activeInstalls: rows.length,
        // Retired rows carry no first_seen, but they can never have belonged
        // to a day still rollable: a first_seen = day row lives at least until
        // day + retention, longer than the raw window keeps `day` reachable.
        newInstalls: [...lifetime.values()].filter((entry) => entry.firstSeen === day).length,
        byVersion: capBuckets(
          countBy(rows, (row) => row.version),
          cap,
        ),
        byOs: capBuckets(
          countBy(rows, (row) => row.os),
          cap,
        ),
        byArch: capBuckets(
          countBy(rows, (row) => row.arch),
          cap,
        ),
        // As of `day`, never as of now: a later install must not retroactively
        // inflate an earlier day's lifetime figure. The `retired` half is
        // as-of-now, which cannot skew a recompute — a prunable row was last
        // seen long before every day raw retention still lets this roll up.
        // A return after pruning is counted twice: the published figure is
        // cumulative observations, not unique installs.
        lifetimeInstalls:
          [...lifetime.values()].filter((entry) => entry.firstSeen <= day).length + retired,
      };
      rollups.set(day, rollup);
      return rollup;
    },
    async readRollup(day) {
      return rollups.get(day) ?? null;
    },
    async readLatestRollupAtOrBefore(day) {
      return (
        [...rollups.values()]
          .filter((rollup) => rollup.day <= day)
          .sort((a, b) => b.day.localeCompare(a.day))[0] ?? null
      );
    },
    async readRollups(fromDay, toDay) {
      return [...rollups.values()]
        .filter((rollup) => rollup.day >= fromDay && rollup.day <= toDay)
        .sort((a, b) => a.day.localeCompare(b.day));
    },
    async findDaysNeedingRollup(fromDay, toDay) {
      const days = new Set<string>();
      for (const row of raw.values()) {
        if (row.day >= fromDay && row.day <= toDay && !rollups.has(row.day)) days.add(row.day);
      }
      return [...days].sort();
    },
    async pruneRawBefore(day) {
      let removed = 0;
      for (const [key, row] of raw) {
        if (row.day < day) {
          raw.delete(key);
          removed += 1;
        }
      }
      // Budget rows for closed days are dead weight — the Postgres twin clears
      // them in the same pass.
      for (const dayKey of budget.keys()) {
        if (dayKey < day) budget.delete(dayKey);
      }
      return removed;
    },
    async pruneLifetimeBefore(day) {
      let removed = 0;
      for (const [hash, entry] of lifetime) {
        if (entry.lastSeen < day) {
          lifetime.delete(hash);
          removed += 1;
        }
      }
      retired += removed;
      return { retired: removed };
    },
    async rollUpMonths() {
      const computedAt = new Date().toISOString();
      const rows = [...monthActive.values()];
      const months = [...new Set(rows.map((row) => row.month))].sort();
      for (const month of months) {
        const inMonth = rows.filter((row) => row.month === month);
        monthRollups.set(month, { month, activeInstalls: inMonth.length, computedAt });
        const byCohort = countBy(
          inMonth.filter((row) => row.cohort !== null),
          (row) => row.cohort ?? "",
        );
        for (const [cohort, installs] of Object.entries(byCohort)) {
          cohortRollups.set(keyOf(cohort, month), { cohort, month, installs, computedAt });
        }
      }
      return months;
    },
    async pruneMonthActiveBefore(month) {
      let removed = 0;
      for (const [key, row] of monthActive) {
        if (row.month < month) {
          monthActive.delete(key);
          removed += 1;
        }
      }
      return removed;
    },
    async readMonthRollups(fromMonth, toMonth) {
      return [...monthRollups.values()]
        .filter((rollup) => rollup.month >= fromMonth && rollup.month <= toMonth)
        .sort((a, b) => a.month.localeCompare(b.month));
    },
    async readCohortRollups(fromCohort) {
      return [...cohortRollups.values()]
        .filter((rollup) => rollup.cohort >= fromCohort)
        .sort((a, b) => a.cohort.localeCompare(b.cohort) || a.month.localeCompare(b.month));
    },
    async writeDistributionSnapshot(day, entries) {
      for (const key of distribution.keys()) {
        if (key.startsWith(`${day}::`)) distribution.delete(key);
      }
      for (const entry of entries) {
        distribution.set(`${day}::${entry.source}::${entry.release}::${entry.platform}`, {
          day,
          ...entry,
        });
      }
      return entries.length;
    },
    async readDistribution(fromDay, toDay) {
      return [...distribution.values()]
        .filter((row) => row.day >= fromDay && row.day <= toDay)
        .sort((a, b) => a.day.localeCompare(b.day));
    },
    rawCount: () => raw.size,
    lifetimeCount: () => lifetime.size,
    monthActiveCount: () => monthActive.size,
    pingWrites: () => pingWrites,
    budgetSpent: (day) => budget.get(day) ?? 0,
  };
}
