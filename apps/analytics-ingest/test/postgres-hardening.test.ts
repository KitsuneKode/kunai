/**
 * The production-hardening behaviour, against real Postgres.
 *
 * Everything asserted here is a property of the SQL, not of the TypeScript
 * around it: what the admission budget actually refuses, whether the lifetime
 * figure is a function of the day it labels, whether the retention sweep and
 * the retired counter really move together, and what the bucket cap stores.
 * The in-memory store mirrors all of it and can prove none of it.
 */

import { beforeAll, describe, expect, test } from "bun:test";

// Side-effecting: honours NEON_FETCH_ENDPOINT. Must precede store construction.
// oxlint-disable-next-line import/no-unassigned-import -- the side effect is the point
import "../src/neon-fetch-endpoint";
import { hashInstallId } from "../src/ingest";
import { DEFAULT_ANALYTICS_LIMITS } from "../src/limits";
import { createPostgresAnalyticsStore } from "../src/postgres-store";
import { buildPublicMetrics } from "../src/public-metrics";
import type { AnalyticsStore } from "../src/store";
import { resetAnalyticsTables, tableCount, TEST_DATABASE_URL, testInstallId } from "./support/pg";

const HASH_SECRET = "local-test-secret";

function storeWith(overrides: Partial<typeof DEFAULT_ANALYTICS_LIMITS> = {}): AnalyticsStore {
  return createPostgresAnalyticsStore(TEST_DATABASE_URL as string, {
    ...DEFAULT_ANALYTICS_LIMITS,
    ...overrides,
  });
}

function ping(
  store: AnalyticsStore,
  day: string,
  n: number,
  dimensions: Partial<Record<"version" | "os" | "arch", string>> = {},
) {
  return store.recordPing({
    day,
    installHash: hashInstallId(HASH_SECRET, testInstallId(n)),
    version: dimensions.version ?? "0.3.0",
    os: dimensions.os ?? "linux",
    arch: dimensions.arch ?? "x64",
  });
}

describe.skipIf(!TEST_DATABASE_URL)("postgres admission budget", () => {
  beforeAll(resetAnalyticsTables);

  test("a spent daily budget stops writing without failing the request", async () => {
    const store = storeWith({ maxPingsPerDay: 3 });
    const day = "1999-04-01";

    const outcomes = [];
    for (let n = 1; n <= 5; n += 1) outcomes.push(await ping(store, day, n));

    expect(outcomes.map((outcome) => outcome.admitted)).toEqual([true, true, true, false, false]);

    const rollup = await store.rollUpDay(day);
    expect(rollup.activeInstalls).toBe(3);
    // The refused pings must not leave a permanent lifetime row either — that
    // table is the one with no natural ceiling.
    expect(rollup.lifetimeInstalls).toBe(3);
  });

  test("the budget is per UTC day, so the next day starts clean", async () => {
    const store = storeWith({ maxPingsPerDay: 2 });
    await ping(store, "1999-04-02", 10);
    await ping(store, "1999-04-02", 11);
    expect((await ping(store, "1999-04-02", 12)).admitted).toBe(false);
    expect((await ping(store, "1999-04-03", 12)).admitted).toBe(true);
  });

  test("repeat pings from one install still cost budget but store one row", async () => {
    const store = storeWith({ maxPingsPerDay: 10 });
    const day = "1999-04-04";
    for (let i = 0; i < 4; i += 1) await ping(store, day, 20);
    expect((await store.rollUpDay(day)).activeInstalls).toBe(1);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("postgres lifetime accounting", () => {
  beforeAll(resetAnalyticsTables);

  test("lifetime is counted as of the rolled-up day, not as of now", async () => {
    const store = storeWith();
    await ping(store, "1999-05-01", 1);
    await ping(store, "1999-05-02", 2);
    await ping(store, "1999-05-03", 3);

    // The regression: `count(*) from install_lifetime` reported 3 for every one
    // of these days, so an install that appeared on the 3rd inflated the 1st.
    expect((await store.rollUpDay("1999-05-01")).lifetimeInstalls).toBe(1);
    expect((await store.rollUpDay("1999-05-02")).lifetimeInstalls).toBe(2);
    expect((await store.rollUpDay("1999-05-03")).lifetimeInstalls).toBe(3);
  });

  test("recomputing a day is idempotent", async () => {
    const store = storeWith();
    const first = await store.rollUpDay("1999-05-02");
    const second = await store.rollUpDay("1999-05-02");
    expect({ ...second, computedAt: "" }).toEqual({ ...first, computedAt: "" });
    // computed_at is the staleness signal, so it must move on every recompute.
    expect(Date.parse(second.computedAt)).toBeGreaterThanOrEqual(Date.parse(first.computedAt));
  });

  test("retiring a silent install deletes the row and keeps the total exact", async () => {
    const store = storeWith();
    const before = (await store.rollUpDay("1999-05-03")).lifetimeInstalls;
    expect(await tableCount("install_lifetime")).toBe(3);

    // Installs unseen since 1999-05-03 — the two that only ever pinged earlier.
    const { retired } = await store.pruneLifetimeBefore("1999-05-03");

    expect(retired).toBe(2);
    expect(await tableCount("install_lifetime")).toBe(1);
    // The rows are gone; the count they contributed is not.
    expect((await store.rollUpDay("1999-05-03")).lifetimeInstalls).toBe(before);
  });

  test("a second sweep with nothing to retire changes nothing", async () => {
    const store = storeWith();
    const before = (await store.rollUpDay("1999-05-03")).lifetimeInstalls;
    expect((await store.pruneLifetimeBefore("1999-05-03")).retired).toBe(0);
    expect((await store.rollUpDay("1999-05-03")).lifetimeInstalls).toBe(before);
  });

  test("a returning install refreshes last_seen instead of being retired", async () => {
    // Hermetic on purpose. The rest of this block accumulates state across
    // tests, and the survivor of the retirement test above still carries
    // last_seen 1999-05-03 — earlier than this cutoff, so the sweep would
    // rightly retire it and `retired` would report that unrelated row rather
    // than anything about the returning install.
    await resetAnalyticsTables();

    const store = storeWith();
    // Two installs, one either side of the cutoff, so the sweep has to
    // discriminate rather than trivially retire nothing: install 2 is silent
    // after May, install 1 comes back in June. Asserting only "retired is 0"
    // against a single install would still pass if the sweep stopped working
    // altogether.
    await ping(store, "1999-05-03", 2);
    await ping(store, "1999-05-10", 1);
    await ping(store, "1999-06-20", 1);

    // Exactly the silent one. Were last_seen not refreshed on the return visit,
    // install 1 would still read 1999-05-10 and be swept too — retired 2,
    // nothing left behind.
    expect((await store.pruneLifetimeBefore("1999-06-01")).retired).toBe(1);
    expect(await tableCount("install_lifetime")).toBe(1);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("postgres bucket cardinality", () => {
  beforeAll(resetAnalyticsTables);

  test("a version flood is capped in storage, not just in the public JSON", async () => {
    const store = storeWith({ maxBucketsPerDimension: 3 });
    const day = "1999-07-01";

    // 12 installs on 12 invented-but-valid semvers, plus a real one with mass.
    for (let n = 1; n <= 12; n += 1) await ping(store, day, n, { version: `9.9.${n}` });
    for (let n = 20; n <= 25; n += 1) await ping(store, day, n, { version: "0.3.0" });

    const rollup = await store.rollUpDay(day);

    // Three named buckets at most, plus the residual.
    expect(Object.keys(rollup.byVersion).length).toBeLessThanOrEqual(4);
    expect(rollup.byVersion["0.3.0"]).toBe(6);
    expect(rollup.byVersion.other).toBeGreaterThan(0);
    // Nothing is lost: the cap folds, it does not drop.
    const total = Object.values(rollup.byVersion).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(rollup.activeInstalls);
    expect(total).toBe(18);
  });

  test("the cap is deterministic, so a recomputed day is byte-identical", async () => {
    const store = storeWith({ maxBucketsPerDimension: 3 });
    const first = await store.rollUpDay("1999-07-01");
    const second = await store.rollUpDay("1999-07-01");
    expect(second.byVersion).toEqual(first.byVersion);
  });

  test("a closed dimension never publishes a bucket recoverable by elimination", async () => {
    const store = storeWith();
    const day = "1999-07-02";
    for (let n = 40; n <= 47; n += 1) await ping(store, day, n, { arch: "x64" });
    await ping(store, day, 48, { arch: "arm64" });

    const rollup = await store.rollUpDay(day);
    expect(rollup.byArch).toEqual({ x64: 8, arm64: 1 });

    // Stored unsuppressed for the operator; published so that `arch` cannot be
    // read off as "activeInstalls minus x64".
    const published = buildPublicMetrics(rollup);
    expect(published.byArch).toEqual({ other: 9 });
    expect(published.activeInstalls).toBe(9);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("postgres rollup recovery", () => {
  beforeAll(resetAnalyticsTables);

  test("a day with raw rows and no rollup is reported as pending", async () => {
    const store = storeWith();
    await ping(store, "1999-08-01", 1);
    await ping(store, "1999-08-02", 2);
    await ping(store, "1999-08-03", 3);
    await store.rollUpDay("1999-08-02");

    expect(await store.findDaysNeedingRollup("1999-08-01", "1999-08-03")).toEqual([
      "1999-08-01",
      "1999-08-03",
    ]);
  });

  test("the range is respected so an outage cannot pull in the whole table", async () => {
    const store = storeWith();
    expect(await store.findDaysNeedingRollup("1999-08-03", "1999-08-03")).toEqual(["1999-08-03"]);
    expect(await store.findDaysNeedingRollup("1999-09-01", "1999-09-30")).toEqual([]);
  });

  test("the public read serves the newest rollup rather than 404ing on a gap", async () => {
    const store = storeWith();
    await store.rollUpDay("1999-08-01");

    // Nothing was ever computed for 1999-08-09; a dead cron must show a stale
    // day rather than take the endpoint down.
    const latest = await store.readLatestRollupAtOrBefore("1999-08-09");
    expect(latest?.day).toBe("1999-08-02");
    expect(await store.readRollup("1999-08-09")).toBeNull();
    expect(await store.readLatestRollupAtOrBefore("1998-01-01")).toBeNull();
  });

  test("raw retention leaves the rollups standing", async () => {
    const store = storeWith();
    expect(await tableCount("ping_day")).toBeGreaterThan(0);
    await store.pruneRawBefore("2000-01-01");
    expect(await tableCount("ping_day")).toBe(0);
    expect((await store.readRollup("1999-08-02"))?.activeInstalls).toBe(1);
  });
});
