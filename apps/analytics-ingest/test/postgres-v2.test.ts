/**
 * The v2 ingest, the M3 budget fix, monthly cohorts and distribution
 * snapshots, against real Postgres. Each is a property of the SQL: whether an
 * over-budget request really writes nothing, what a cohort rollup stores, and
 * whether a jsonb snapshot round-trips through the HTTP driver.
 */

import { beforeAll, describe, expect, test } from "bun:test";

// Side-effecting: honours NEON_FETCH_ENDPOINT. Must precede store construction.
// oxlint-disable-next-line import/no-unassigned-import -- the side effect is the point
import "../src/neon-fetch-endpoint";
import { neon } from "@neondatabase/serverless";

import { hashInstallId, ingestAnalyticsPing } from "../src/ingest";
import { DEFAULT_ANALYTICS_LIMITS } from "../src/limits";
import { createPostgresAnalyticsStore } from "../src/postgres-store";
import type { AnalyticsStore } from "../src/store";
import { resetAnalyticsTables, tableCount, TEST_DATABASE_URL, testInstallId } from "./support/pg";

const HASH_SECRET = "local-test-secret";

function storeWith(maxPingsPerDay = DEFAULT_ANALYTICS_LIMITS.maxPingsPerDay): AnalyticsStore {
  // SAFETY: every caller runs inside a describe skipped when the URL is unset.
  return createPostgresAnalyticsStore(TEST_DATABASE_URL as string, {
    ...DEFAULT_ANALYTICS_LIMITS,
    maxPingsPerDay,
  });
}

function hashOf(n: number): string {
  return hashInstallId(HASH_SECRET, testInstallId(n, "v2"));
}

/** The budget row, with `xmin`: it changes on any update, so equal means untouched. */
async function budgetRow(day: string): Promise<{ attempts: string; xmin: string } | null> {
  // SAFETY: only called inside a describe skipped when the URL is unset.
  const sql = neon(TEST_DATABASE_URL as string);
  // SAFETY: the select list names exactly the columns of the row type.
  const rows = (await sql.query(
    "select attempts::text as attempts, xmin::text as xmin from ingest_budget where day = $1::date",
    [day],
  )) as { attempts: string; xmin: string }[];
  return rows[0] ?? null;
}

describe.skipIf(!TEST_DATABASE_URL)("postgres v2 ingest and the M3 budget", () => {
  beforeAll(resetAnalyticsTables);

  test("an over-budget request writes nothing, not even the budget row", async () => {
    const store = storeWith(2);
    const day = "1999-05-01";
    const ping = (n: number) =>
      store.recordPing({ day, installHash: hashOf(n), version: "0.3.0", os: "linux", arch: "x64" });
    await ping(1);
    await ping(2);
    const before = await budgetRow(day);
    const rowsBefore = [await tableCount("ping_day"), await tableCount("month_active")];

    expect(await ping(3)).toEqual({ admitted: false, duplicate: false });
    expect(await ping(4)).toEqual({ admitted: false, duplicate: false });

    expect(before?.attempts).toBe("2");
    expect(await budgetRow(day)).toEqual(before);
    expect([await tableCount("ping_day"), await tableCount("month_active")]).toEqual(rowsBefore);
  });

  test("a repeat ping is a duplicate and leaves the budget row untouched", async () => {
    const store = storeWith(10);
    const day = "1999-05-02";
    const input = { day, installHash: hashOf(5), version: "0.3.0", os: "linux", arch: "x64" };
    expect(await store.recordPing(input)).toEqual({ admitted: true, duplicate: false });
    const before = await budgetRow(day);
    expect(await store.recordPing(input)).toEqual({ admitted: true, duplicate: true });
    expect(await budgetRow(day)).toEqual(before);
  });

  test("v1 UUID, v1 digest and v2 all land through the real store", async () => {
    const store = storeWith();
    // Before Kunai's analytics existed, so no real rollup could hold this day,
    // yet late enough for the v2 cohort check, which refuses pre-2024 months.
    const now = Date.parse("2024-02-10T06:00:00.000Z");
    const lifetimeBefore = await tableCount("install_lifetime");
    const bodies = [
      { installId: testInstallId(10, "v2"), version: "0.2.9", os: "linux", arch: "x64", ts: now },
      { installId: "e".repeat(64), version: "0.3.0", os: "android", arch: "arm64", ts: now },
      {
        id: "f".repeat(64),
        cohort: "2024-01",
        day: "2024-02-10",
        version: "0.5.0",
        os: "android",
        arch: "arm64",
      },
    ];
    for (const body of bodies) {
      const result = await ingestAnalyticsPing({
        method: "POST",
        body,
        hashSecret: HASH_SECRET,
        store,
        now,
      });
      expect(result).toEqual({ ok: true, day: "2024-02-10", stored: true, duplicate: false });
    }
    // Only the two v1 pings may write install_lifetime.
    expect(await tableCount("install_lifetime")).toBe(lifetimeBefore + 2);
    expect((await store.rollUpDay("2024-02-10")).byOs).toEqual({ linux: 1, android: 2 });
  });

  test("a v2 ping writes ping_day and month_active, never install_lifetime", async () => {
    const store = storeWith();
    const lifetimeBefore = await tableCount("install_lifetime");
    for (let n = 20; n < 26; n += 1) {
      await store.recordPing({
        day: "1999-07-31",
        installHash: hashOf(n),
        version: "0.5.0",
        os: "linux",
        arch: "x64",
        // A client a day ahead counts toward its own month.
        v2: { activeMonth: "1999-08", cohort: "1999-07" },
      });
    }
    expect(await tableCount("install_lifetime")).toBe(lifetimeBefore);
    expect((await store.rollUpDay("1999-07-31")).activeInstalls).toBe(6);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("postgres monthly and cohort rollups", () => {
  beforeAll(resetAnalyticsTables);

  test("months and cohorts are rolled up, then survive the prune", async () => {
    const store = storeWith();
    const ping = (n: number, day: string, activeMonth: string, cohort: string) =>
      store.recordPing({
        day,
        installHash: hashOf(n + (activeMonth === "1999-10" ? 1000 : 0)),
        version: "0.5.0",
        os: "linux",
        arch: "x64",
        v2: { activeMonth, cohort },
      });
    // Distinct installs per batch, so each batch can go concurrently.
    const batch = (count: number, day: string, activeMonth: string) =>
      Promise.all(
        Array.from({ length: count }, (_, i) => ping(i + 1, day, activeMonth, "1999-09")),
      );
    await batch(6, "1999-09-05", "1999-09");
    // Pinging again later in the month is still one install that month.
    await batch(6, "1999-09-20", "1999-09");
    await batch(4, "1999-10-02", "1999-10");
    // A v1 ping counts toward the month and has no cohort.
    await store.recordPing({
      day: "1999-10-02",
      installHash: hashOf(500),
      version: "0.3.0",
      os: "linux",
      arch: "x64",
    });

    expect(await store.rollUpMonths()).toEqual(["1999-09", "1999-10"]);
    const months = await store.readMonthRollups("1999-09", "1999-10");
    expect(months.map(({ month, activeInstalls }) => ({ month, activeInstalls }))).toEqual([
      { month: "1999-09", activeInstalls: 6 },
      { month: "1999-10", activeInstalls: 5 },
    ]);
    const cohorts = await store.readCohortRollups("1999-01");
    expect(cohorts.map(({ cohort, month, installs }) => ({ cohort, month, installs }))).toEqual([
      { cohort: "1999-09", month: "1999-09", installs: 6 },
      { cohort: "1999-09", month: "1999-10", installs: 4 },
    ]);

    const monthRowsBefore = await tableCount("month_active");
    expect(await store.pruneMonthActiveBefore("1999-10")).toBe(6);
    expect(await tableCount("month_active")).toBe(monthRowsBefore - 6);
    // September is final now: a later run does not touch it.
    expect(await store.rollUpMonths()).toEqual(["1999-10"]);
    expect((await store.readMonthRollups("1999-09", "1999-09"))[0]?.activeInstalls).toBe(6);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("postgres distribution snapshots", () => {
  beforeAll(resetAnalyticsTables);

  test("a snapshot round-trips, and rewriting a day replaces it", async () => {
    const store = storeWith();
    await store.writeDistributionSnapshot("1999-03-01", [
      { source: "github", release: "v0.4.0", platform: "linux-x64", cumulative: 5_000_000_000 },
      { source: "npm", release: "", platform: "launcher", cumulative: 12 },
    ]);
    expect(
      await store.writeDistributionSnapshot("1999-03-01", [
        { source: "github", release: "v0.4.0", platform: "linux-x64", cumulative: 5_000_000_100 },
        { source: "marker", release: "v0.4.0", platform: "install", cumulative: 3 },
      ]),
    ).toBe(2);

    expect(await store.readDistribution("1999-03-01", "1999-03-01")).toEqual([
      {
        day: "1999-03-01",
        source: "github",
        release: "v0.4.0",
        platform: "linux-x64",
        cumulative: 5_000_000_100,
      },
      {
        day: "1999-03-01",
        source: "marker",
        release: "v0.4.0",
        platform: "install",
        cumulative: 3,
      },
    ]);
  });
});
