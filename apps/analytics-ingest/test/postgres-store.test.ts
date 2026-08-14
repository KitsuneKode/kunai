import { describe, expect, test } from "bun:test";

import { createPostgresAnalyticsStore } from "../src/postgres-store";

const DATABASE_URL = process.env.DATABASE_URL?.trim();

/**
 * Runs only when a scratch database is configured. Never point this at a
 * database holding real aggregates: it writes and prunes.
 *
 * Apply the schema first:
 *   DATABASE_URL=... bun run --cwd apps/analytics-ingest migrate
 */
describe.skipIf(!DATABASE_URL)("postgres store", () => {
  const day = "1999-01-01";
  const installHash = "a".repeat(64);

  test("recordPing is idempotent per (day, installHash)", async () => {
    const store = createPostgresAnalyticsStore(DATABASE_URL as string);
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
    const store = createPostgresAnalyticsStore(DATABASE_URL as string);
    await store.recordPing({ day, installHash, version: "0.3.0", os: "linux", arch: "x64" });
    const written = await store.rollUpDay(day);
    const read = await store.readRollup(day);
    expect(read).toEqual(written);

    const range = await store.readRollups("1998-12-31", "1999-01-02");
    expect(range.map((entry) => entry.day)).toContain(day);

    await store.pruneRawBefore("1999-01-02");
  });

  test("pruneRawBefore reports how many raw rows it removed", async () => {
    const store = createPostgresAnalyticsStore(DATABASE_URL as string);
    await store.recordPing({ day, installHash, version: "0.3.0", os: "linux", arch: "x64" });
    expect(await store.pruneRawBefore("1999-01-02")).toBe(1);
    expect(await store.pruneRawBefore("1999-01-02")).toBe(0);
  });
});
