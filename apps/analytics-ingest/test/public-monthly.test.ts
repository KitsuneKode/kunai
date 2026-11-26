import { describe, expect, test } from "bun:test";

import { ingestAnalyticsPing } from "../src/ingest";
import { createMemoryAnalyticsStore } from "../src/memory-store";
import {
  buildPublicMonthly,
  isRetentionCellPublishable,
  RETENTION_MIN_COHORT_SIZE,
  shiftMonth,
} from "../src/public-monthly";
import type { CohortRollup, MonthRollup } from "../src/store";

const STAMP = "2026-11-02T19:00:00.000Z";

function cohortRow(cohort: string, month: string, installs: number): CohortRollup {
  return { cohort, month, installs, computedAt: STAMP };
}

function monthRow(month: string, activeInstalls: number): MonthRollup {
  return { month, activeInstalls, computedAt: STAMP };
}

describe("month arithmetic", () => {
  test("crosses year boundaries both ways", () => {
    expect(shiftMonth("2026-11", 2)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-06", -12)).toBe("2025-06");
  });
});

describe("retention guards", () => {
  test("a cell needs a cohort of 10 and at least 5 on each side of it", () => {
    expect(RETENTION_MIN_COHORT_SIZE).toBe(10);
    expect(isRetentionCellPublishable(10, 5)).toBe(true);
    expect(isRetentionCellPublishable(9, 5)).toBe(false);
    expect(isRetentionCellPublishable(20, 4)).toBe(false);
    // 12 retained of 14 also says "two left".
    expect(isRetentionCellPublishable(14, 12)).toBe(false);
    expect(isRetentionCellPublishable(14, 9)).toBe(true);
  });
});

describe("buildPublicMonthly", () => {
  const current = "2026-11";

  test("small cohorts and small cells are suppressed, never zeroed", () => {
    const monthly = buildPublicMonthly(
      [monthRow("2026-08", 40), monthRow("2026-09", 3), monthRow("2026-10", 52)],
      [
        // Large cohort: M1 publishable, M2 too few retained, M3 too few left.
        cohortRow("2026-07", "2026-07", 20),
        cohortRow("2026-07", "2026-08", 11),
        cohortRow("2026-07", "2026-09", 4),
        cohortRow("2026-07", "2026-10", 16),
        // Under the retention minimum: size published, no cell is.
        cohortRow("2026-08", "2026-08", 7),
        cohortRow("2026-08", "2026-09", 5),
        // Under the floor: nothing published.
        cohortRow("2026-09", "2026-09", 3),
      ],
      current,
    );

    expect(monthly?.throughMonth).toBe("2026-10");
    expect(monthly?.months).toEqual([
      { month: "2026-08", activeInstalls: 40 },
      { month: "2026-09", activeInstalls: null },
      { month: "2026-10", activeInstalls: 52 },
    ]);
    expect(monthly?.cohorts).toEqual([
      {
        cohort: "2026-07",
        newInstalls: 20,
        retained: [
          { offset: 1, installs: 11 },
          { offset: 2, installs: null },
          { offset: 3, installs: null },
        ],
      },
      {
        cohort: "2026-08",
        newInstalls: 7,
        retained: [
          { offset: 1, installs: null },
          { offset: 2, installs: null },
        ],
      },
      { cohort: "2026-09", newInstalls: null, retained: [{ offset: 1, installs: null }] },
    ]);
  });

  test("the current month is never published, as a month or as a cell", () => {
    const monthly = buildPublicMonthly(
      [monthRow("2026-10", 30), monthRow("2026-11", 31)],
      [cohortRow("2026-10", "2026-10", 30), cohortRow("2026-10", "2026-11", 15)],
      current,
    );
    expect(monthly?.months.map((month) => month.month)).toEqual(["2026-10"]);
    expect(monthly?.cohorts).toEqual([{ cohort: "2026-10", newInstalls: 30, retained: [] }]);
  });

  test("retention stops at M6", () => {
    const rows = [cohortRow("2025-12", "2025-12", 40)];
    for (let k = 1; k <= 9; k += 1) rows.push(cohortRow("2025-12", shiftMonth("2025-12", k), 20));
    const cohort = buildPublicMonthly([], rows, current)?.cohorts[0];
    expect(cohort?.retained.map((cell) => cell.offset)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("null before any complete month has a rollup", () => {
    expect(buildPublicMonthly([monthRow("2026-11", 9)], [], current)).toBeNull();
  });
});

/**
 * The storage half: cohorts reach `cohort_rollup` through `month_active`,
 * with no per-install row left once the month is pruned.
 */
describe("cohort storage", () => {
  const SECRET = "test-secret";

  async function pingV2(
    store: ReturnType<typeof createMemoryAnalyticsStore>,
    n: number,
    day: string,
    cohort: string,
  ) {
    // The client's id rotates each month; the fixture models that by month.
    const id = `${n.toString(16).padStart(4, "0")}${day.slice(0, 7).replace("-", "")}`.padEnd(
      64,
      "0",
    );
    const result = await ingestAnalyticsPing({
      method: "POST",
      body: { id, cohort, day, version: "0.5.0", os: "linux", arch: "x64" },
      hashSecret: SECRET,
      store,
      now: Date.parse(`${day}T06:00:00.000Z`),
    });
    expect(result.ok).toBe(true);
  }

  test("new installs per month and Mk retention come from month rows", async () => {
    const store = createMemoryAnalyticsStore();
    for (let n = 1; n <= 12; n += 1) await pingV2(store, n, "2026-10-05", "2026-10");
    // Pinging on several days of a month is still one install that month.
    for (let n = 1; n <= 12; n += 1) await pingV2(store, n, "2026-10-20", "2026-10");
    for (let n = 1; n <= 6; n += 1) await pingV2(store, n, "2026-11-03", "2026-10");
    for (let n = 50; n <= 52; n += 1) await pingV2(store, n, "2026-11-03", "2026-11");

    expect(await store.rollUpMonths()).toEqual(["2026-10", "2026-11"]);
    const cohorts = await store.readCohortRollups("2026-01");
    expect(cohorts.map(({ cohort, month, installs }) => ({ cohort, month, installs }))).toEqual([
      { cohort: "2026-10", month: "2026-10", installs: 12 },
      { cohort: "2026-10", month: "2026-11", installs: 6 },
      { cohort: "2026-11", month: "2026-11", installs: 3 },
    ]);
    const months = await store.readMonthRollups("2026-10", "2026-11");
    expect(months.map((month) => month.activeInstalls)).toEqual([12, 9]);

    // Pruning drops per-install rows; the aggregate rollups stay.
    expect(await store.pruneMonthActiveBefore("2026-11")).toBe(12);
    expect(await store.rollUpMonths()).toEqual(["2026-11"]);
    expect((await store.readCohortRollups("2026-10"))[0]?.installs).toBe(12);

    const published = buildPublicMonthly(
      await store.readMonthRollups("2026-01", "2026-12"),
      await store.readCohortRollups("2026-01"),
      "2026-12",
    );
    // 6 retained of 12 has 6 on each side: publishable.
    expect(published?.cohorts[0]).toEqual({
      cohort: "2026-10",
      newInstalls: 12,
      retained: [{ offset: 1, installs: 6 }],
    });
    // A cohort of three is under the floor.
    expect(published?.cohorts[1]?.newInstalls).toBeNull();
  });
});
