import { countBy, type AnalyticsStore, type DailyRollup, type RecordPingInput } from "./store";

/** In-process test double. Mirrors the Postgres semantics, including idempotency. */
export function createMemoryAnalyticsStore(): AnalyticsStore & {
  readonly rawCount: () => number;
} {
  const raw = new Map<string, RecordPingInput>();
  const lifetime = new Set<string>();
  const rollups = new Map<string, DailyRollup>();

  const keyOf = (day: string, hash: string) => `${day}::${hash}`;

  return {
    async recordPing(input) {
      const key = keyOf(input.day, input.installHash);
      if (raw.has(key)) return;
      raw.set(key, input);
      lifetime.add(input.installHash);
    },
    async rollUpDay(day) {
      const rows = [...raw.values()].filter((row) => row.day === day);
      const rollup: DailyRollup = {
        day,
        activeInstalls: rows.length,
        byVersion: countBy(rows, (row) => row.version),
        byOs: countBy(rows, (row) => row.os),
        byArch: countBy(rows, (row) => row.arch),
        lifetimeInstalls: lifetime.size,
      };
      rollups.set(day, rollup);
      return rollup;
    },
    async readRollup(day) {
      return rollups.get(day) ?? null;
    },
    async readRollups(fromDay, toDay) {
      return [...rollups.values()]
        .filter((rollup) => rollup.day >= fromDay && rollup.day <= toDay)
        .sort((a, b) => a.day.localeCompare(b.day));
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
    rawCount: () => raw.size,
  };
}
