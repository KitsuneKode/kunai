import { beforeAll, describe, expect, test } from "bun:test";

// Side-effecting: honours NEON_FETCH_ENDPOINT. Must precede store construction.
// oxlint-disable-next-line import/no-unassigned-import -- the side effect is the point
import "../src/neon-fetch-endpoint";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createPostgresAnalyticsStore,
  PRUNE_LIFETIME_SQL,
  RECORD_PING_SQL,
  ROLL_UP_DAY_SQL,
} from "../src/postgres-store";
import { resetAnalyticsTables, TEST_DATABASE_URL, testInstallId } from "./support/pg";

test("recordPing charges the budget and writes both tables in one SQL statement", () => {
  expect(RECORD_PING_SQL).toContain("with budget as");
  expect(RECORD_PING_SQL).toContain("insert into ingest_budget");
  expect(RECORD_PING_SQL).toContain("ping_day_insert as");
  expect(RECORD_PING_SQL).toContain("insert into install_lifetime");
  expect(RECORD_PING_SQL).toContain("on conflict (day, install_hash) do nothing");
  // Both inserts select from `admitted`, which is what forces them to run after
  // the budget upsert rather than in an unspecified order. Asserted per-insert
  // rather than by counting occurrences, since the closing result count reads
  // `admitted` too and made a bare count say 3.
  expect(RECORD_PING_SQL).toMatch(/insert into ping_day[\s\S]*?from admitted/);
  expect(RECORD_PING_SQL).toMatch(/insert into install_lifetime[\s\S]*?from admitted/);
});

test("the rollup reads lifetime as of the day, not as of now", () => {
  // The bug this pins: `count(*) from install_lifetime` counted installs first
  // seen *after* the day being rolled up, so yesterday's published lifetime
  // figure moved every time it was recomputed.
  expect(ROLL_UP_DAY_SQL).toContain("from install_lifetime where first_seen <= $1::date");
  expect(ROLL_UP_DAY_SQL).not.toContain("select count(*) from install_lifetime\n");
});

test("the rollup is a single statement so its parts share one snapshot", () => {
  expect(ROLL_UP_DAY_SQL.startsWith("with ")).toBe(true);
  expect(ROLL_UP_DAY_SQL).toContain("insert into daily_rollup");
  for (const dimension of ["by_version", "by_os", "by_arch"]) {
    expect(ROLL_UP_DAY_SQL).toContain(`${dimension} as (`);
  }
});

test("lifetime pruning and the retired counter move in one statement", () => {
  expect(PRUNE_LIFETIME_SQL).toContain("delete from install_lifetime where last_seen < $1::date");
  expect(PRUNE_LIFETIME_SQL).toContain("update lifetime_retired set retired_installs");
});

test("postgres suites mint disjoint install ids at the same n", () => {
  // Main failed after #325 with Expected: 8, Received: 5 on lifetimeInstalls.
  // Hardening pings installs 1-3 on May; lifecycle pings 1-8 on February.
  // first_seen is write-once, so 1-3 kept May and dropped out of February's
  // count: 8 - 3 = 5. The ids must not be the same UUID.
  const ids = (["lifecycle", "hardening", "store"] as const).map((suite) =>
    testInstallId(1, suite),
  );
  expect(new Set(ids).size).toBe(3);
});

test("postgres tests mint install ids only through the namespaced helper", () => {
  const dir = join(import.meta.dir);
  // Skip this file: it is the assertion, not a minter.
  const files = readdirSync(dir).filter(
    (name) => name.endsWith(".test.ts") && name !== "postgres-store.test.ts",
  );
  for (const name of files) {
    const source = readFileSync(join(dir, name), "utf8");
    expect(source.includes("function installId("), name).toBe(false);
  }
});

/**
 * Runs only when a scratch database is configured. Never point this at a
 * database holding real aggregates: it writes and prunes.
 *
 * Locally, `bun run --cwd apps/analytics-ingest test:pg` brings up the
 * throwaway Postgres in `docker-compose.yml`, migrates it, and runs this.
 *
 * Against any other database, apply the schema and then opt in explicitly:
 *   DATABASE_URL=... bun run --cwd apps/analytics-ingest migrate
 *   ANALYTICS_TEST_DATABASE_URL=... bun run --cwd apps/analytics-ingest test
 */
describe.skipIf(!TEST_DATABASE_URL)("postgres store", () => {
  const day = "1999-01-01";
  const installHash = "a".repeat(64);

  // Own the database outright: install_lifetime is permanent, so a row another
  // suite left behind would shift the lifetime figures asserted here.
  beforeAll(resetAnalyticsTables);

  test("recordPing is idempotent per (day, installHash)", async () => {
    const store = createPostgresAnalyticsStore(TEST_DATABASE_URL as string);
    await store.pruneRawBefore("1999-01-02");

    for (let i = 0; i < 3; i += 1) {
      await store.recordPing({ day, installHash, version: "0.3.0", os: "linux", arch: "x64" });
    }

    const rollup = await store.rollUpDay(day);
    expect(rollup.activeInstalls).toBe(1);
    expect(rollup.byVersion).toEqual({ "0.3.0": 1 });
    expect(rollup.byOs).toEqual({ linux: 1 });

    await store.pruneRawBefore("1999-01-02");
  });

  test("rollUpDay persists a readable rollup", async () => {
    const store = createPostgresAnalyticsStore(TEST_DATABASE_URL as string);
    await store.recordPing({ day, installHash, version: "0.3.0", os: "linux", arch: "x64" });
    const written = await store.rollUpDay(day);
    const read = await store.readRollup(day);
    expect(read).toEqual(written);

    const range = await store.readRollups("1998-12-31", "1999-01-02");
    expect(range.map((entry) => entry.day)).toContain(day);

    await store.pruneRawBefore("1999-01-02");
  });

  test("pruneRawBefore reports how many raw rows it removed", async () => {
    const store = createPostgresAnalyticsStore(TEST_DATABASE_URL as string);
    await store.recordPing({ day, installHash, version: "0.3.0", os: "linux", arch: "x64" });
    expect(await store.pruneRawBefore("1999-01-02")).toBe(1);
    expect(await store.pruneRawBefore("1999-01-02")).toBe(0);
  });
});
