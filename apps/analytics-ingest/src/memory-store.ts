import { DEFAULT_ANALYTICS_LIMITS, type AnalyticsLimits } from "./limits";
import {
  capBuckets,
  countBy,
  type AnalyticsStore,
  type DailyRollup,
  type RecordPingInput,
} from "./store";

/** In-process test double. Mirrors the Postgres semantics, including idempotency. */
export function createMemoryAnalyticsStore(
  limits: AnalyticsLimits = DEFAULT_ANALYTICS_LIMITS,
): AnalyticsStore & {
  readonly rawCount: () => number;
  readonly lifetimeCount: () => number;
} {
  const raw = new Map<string, RecordPingInput>();
  /** installHash → { firstSeen, lastSeen }, mirroring install_lifetime. */
  const lifetime = new Map<string, { firstSeen: string; lastSeen: string }>();
  const rollups = new Map<string, DailyRollup>();
  const budget = new Map<string, number>();
  let retired = 0;

  const keyOf = (day: string, hash: string) => `${day}::${hash}`;

  return {
    async recordPing(input) {
      const attempts = (budget.get(input.day) ?? 0) + 1;
      budget.set(input.day, attempts);
      if (attempts > limits.maxPingsPerDay) return { admitted: false };

      const seen = lifetime.get(input.installHash);
      if (!seen) lifetime.set(input.installHash, { firstSeen: input.day, lastSeen: input.day });
      else if (seen.lastSeen < input.day) seen.lastSeen = input.day;

      const key = keyOf(input.day, input.installHash);
      if (!raw.has(key)) raw.set(key, input);
      return { admitted: true };
    },
    async rollUpDay(day) {
      const rows = [...raw.values()].filter((row) => row.day === day);
      const cap = limits.maxBucketsPerDimension;
      const rollup: DailyRollup = {
        day,
        computedAt: new Date().toISOString(),
        activeInstalls: rows.length,
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
        // inflate an earlier day's lifetime figure.
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
    rawCount: () => raw.size,
    lifetimeCount: () => lifetime.size,
  };
}
