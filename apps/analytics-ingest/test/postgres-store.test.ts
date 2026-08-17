import { describe, expect, test } from "bun:test";

// Side-effecting: honours NEON_FETCH_ENDPOINT. Must precede store construction.
import "../src/neon-fetch-endpoint";
import { createPostgresAnalyticsStore, RECORD_PING_SQL } from "../src/postgres-store";

/**
 * Deliberately NOT `DATABASE_URL`. These tests write and prune, and
 * `DATABASE_URL` is set in far too many shells for something destructive to
 * key off it — a stray one must never let `bun run test` mutate a real
 * database. Opting in has to be explicit.
 */
const TEST_DATABASE_URL = process.env.ANALYTICS_TEST_DATABASE_URL?.trim();

test("recordPing writes ping-day and lifetime state in one SQL statement", () => {
  expect(RECORD_PING_SQL).toContain("with ping_day_insert as");
  expect(RECORD_PING_SQL).toContain("insert into install_lifetime");
  expect(RECORD_PING_SQL).toContain("on conflict (day, install_hash) do nothing");
  expect(RECORD_PING_SQL).toContain("on conflict (install_hash) do nothing");
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
