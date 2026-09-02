/**
 * The whole ingest chain against real Postgres: HTTP payload in, published
 * metrics out, retention applied.
 *
 * The in-memory store cannot prove any of this. Everything asserted here is a
 * property of the SQL itself — the data-modifying CTE's two independent
 * conflict targets, `jsonb` round-tripping through `by_*`, `date`/`timestamptz`
 * casts surviving the HTTP driver, and what `delete ... where day < $1`
 * actually removes. Those are exactly the failures that reach production
 * looking like a healthy deploy.
 */

import { beforeAll, describe, expect, test } from "bun:test";

// Side-effecting: honours NEON_FETCH_ENDPOINT. Must precede store construction.
// oxlint-disable-next-line import/no-unassigned-import -- the side effect is the point
import "../src/neon-fetch-endpoint";
import { hashInstallId, ingestAnalyticsPing, RAW_RETENTION_DAYS } from "../src/ingest";
import { createPostgresAnalyticsStore } from "../src/postgres-store";
import { buildPublicMetrics, SMALL_CELL_FLOOR } from "../src/public-metrics";
import type { AnalyticsStore } from "../src/store";

/**
 * Deliberately NOT `DATABASE_URL`. These tests write and prune, and
 * `DATABASE_URL` is set in far too many shells for something destructive to
 * key off it — a stray one must never let `bun run test` mutate a real
 * database. Opting in has to be explicit.
 */
const TEST_DATABASE_URL = process.env.ANALYTICS_TEST_DATABASE_URL?.trim();

/** Far enough back that no real rollup could occupy these days. */
const DAY = "1999-02-01";
const OLD_DAY = "1999-01-01";
/** A third scratch day, so the digest case cannot perturb the counts above. */
const OTHER_DAY = "1999-02-02";
const HASH_SECRET = "local-test-secret";

function installId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

async function ping(store: AnalyticsStore, n: number, version: string, now: number) {
  return ingestAnalyticsPing({
    method: "POST",
    body: { installId: installId(n), version, os: "linux", arch: "x64", ts: now },
    hashSecret: HASH_SECRET,
    store,
    now,
  });
}

describe.skipIf(!TEST_DATABASE_URL)("postgres ingest lifecycle", () => {
  let store: AnalyticsStore;

  beforeAll(async () => {
    store = createPostgresAnalyticsStore(TEST_DATABASE_URL as string);
    // These tests own the two scratch days outright.
    await store.pruneRawBefore("1999-03-01");
  });

  test("a real payload lands as one row and one lifetime install", async () => {
    const now = Date.parse(`${DAY}T12:00:00Z`);
    const result = await ping(store, 1, "0.3.0", now);

    expect(result.ok).toBe(true);

    // Same install, same day, three more times: the (day, install_hash)
    // primary key is the once-per-day gate, not an application check.
    await ping(store, 1, "0.3.0", now);
    await ping(store, 1, "0.3.0", now);

    const rollup = await store.rollUpDay(DAY);
    expect(rollup.activeInstalls).toBe(1);
  });

  test("dimensions group and round-trip through jsonb", async () => {
    const now = Date.parse(`${DAY}T12:00:00Z`);
    // Install 1 included deliberately: this asserts a total of 8, so it seeds
    // all 8 rather than inheriting one from the test above. Re-pinging a day an
    // install already has is a no-op by the (day, install_hash) primary key.
    for (let n = 1; n <= 7; n += 1) await ping(store, n, "0.3.0", now);
    // One straggler on an older version: below the floor on its own.
    await ping(store, 8, "0.2.9", now);

    const rollup = await store.rollUpDay(DAY);

    expect(rollup.activeInstalls).toBe(8);
    expect(rollup.byVersion).toEqual({ "0.3.0": 7, "0.2.9": 1 });
    expect(rollup.byOs).toEqual({ linux: 8 });
    expect(rollup.byArch).toEqual({ x64: 8 });
    expect(rollup.computedAt).not.toBe("");
  });

  test("published metrics suppress the small bucket without losing its count", async () => {
    const rollup = await store.rollUpDay(DAY);
    const metrics = buildPublicMetrics(rollup);

    expect(metrics.byVersion["0.2.9"]).toBeUndefined();
    expect(metrics.byVersion.other).toBe(1);
    expect(metrics.byVersion["0.3.0"]).toBe(7);

    const published = Object.values(metrics.byVersion).reduce((sum, n) => sum + n, 0);
    expect(published).toBe(metrics.activeInstalls);
    expect(SMALL_CELL_FLOOR).toBeGreaterThan(1);
  });

  test("updatedAt reports when the rollup was computed, not when it was read", async () => {
    const rollup = await store.rollUpDay(DAY);
    const metrics = buildPublicMetrics(rollup);

    expect(metrics.updatedAt).toBe(rollup.computedAt);
    // A dead cron must look stale rather than fresh.
    expect(Date.parse(metrics.updatedAt)).toBeLessThanOrEqual(Date.now() + 1000);
  });

  test("the same install on a second day is active twice but lifetime once", async () => {
    const oldNow = Date.parse(`${OLD_DAY}T12:00:00Z`);
    const now = Date.parse(`${DAY}T12:00:00Z`);

    // Seed every install this asserts on, rather than inheriting 2..8 from the
    // two tests above. Reading counts that earlier tests happened to leave
    // behind made this fail on main with `Expected: 8, Received: 5` whenever
    // the file's tests did not all land first -- a property of the run order,
    // not of the SQL. Re-pinging an install on a day it already has is a no-op
    // by the (day, install_hash) primary key, so this is safe to repeat.
    for (let n = 1; n <= 8; n += 1) {
      await ping(store, n, n === 8 ? "0.2.9" : "0.3.0", now);
    }
    await ping(store, 1, "0.3.0", oldNow);

    const older = await store.rollUpDay(OLD_DAY);
    const newer = await store.rollUpDay(DAY);

    expect(older.activeInstalls).toBe(1);
    expect(newer.activeInstalls).toBe(8);
    // Eight distinct installs across both days; install 1 is not counted twice.
    expect(newer.lifetimeInstalls).toBe(8);
  });

  test("retention removes raw days and leaves the rollup standing", async () => {
    const removed = await store.pruneRawBefore(DAY);
    expect(removed).toBe(1);

    // The rollup is permanent: the published history must survive its
    // source rows expiring.
    const kept = await store.readRollup(OLD_DAY);
    expect(kept?.activeInstalls).toBe(1);

    // Recomputing a pruned day would zero it — the cron only ever rolls up
    // yesterday, well inside the window.
    expect(RAW_RETENTION_DAYS).toBeGreaterThan(1);
    expect(await store.pruneRawBefore(DAY)).toBe(0);
  });

  test("a rejected payload writes nothing at all", async () => {
    const now = Date.parse(`${DAY}T12:00:00Z`);
    const before = await store.rollUpDay(DAY);

    const bad = await ingestAnalyticsPing({
      method: "POST",
      body: { installId: "not-a-uuid", version: "0.3.0", os: "linux", arch: "x64", ts: now },
      hashSecret: HASH_SECRET,
      store,
      now,
    });
    const forged = await ingestAnalyticsPing({
      method: "POST",
      body: { installId: installId(99), version: "9.9.9-evil", os: "plan9", arch: "x64", ts: now },
      hashSecret: HASH_SECRET,
      store,
      now,
    });

    expect(bad.ok).toBe(false);
    expect(forged.ok).toBe(false);

    const after = await store.rollUpDay(DAY);
    expect(after.activeInstalls).toBe(before.activeInstalls);
    expect(after.byOs).toEqual(before.byOs);
  });

  test("the stored hash is the HMAC, never the raw install id", async () => {
    const raw = installId(1);
    const hash = hashInstallId(HASH_SECRET, raw);

    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(raw);
    // A different secret must not resolve to the same install.
    expect(hashInstallId("another-secret", raw)).not.toBe(hash);
  });

  /**
   * The shape every 0.3.0 client sends, through the real store.
   *
   * The suites above ping with UUIDs, which is what pre-0.3.0 installs send and
   * what this file was written against. Accepting a digest is checked at the
   * parser, but nothing proved one survives the round trip into a rollup — and
   * that is the only path a shipped client will ever take, so it has to be
   * exercised against Postgres rather than inferred from the parser.
   */
  test("a client-side digest counts as an install, exactly like a uuid", async () => {
    const now = Date.parse(`${OTHER_DAY}T12:00:00Z`);
    const digest = "a1b2c3d4".repeat(8); // 64 hex chars, the sha256 shape
    expect(digest).toHaveLength(64);

    const first = await ingestAnalyticsPing({
      method: "POST",
      body: { installId: digest, version: "0.3.0", os: "linux", arch: "arm64", ts: now },
      hashSecret: HASH_SECRET,
      store,
      now,
    });
    expect(first.ok).toBe(true);

    // Same digest twice is the same install, not two: the (day, install_hash)
    // primary key has to key off the digest exactly as it does off a uuid.
    await ingestAnalyticsPing({
      method: "POST",
      body: { installId: digest, version: "0.3.0", os: "linux", arch: "arm64", ts: now },
      hashSecret: HASH_SECRET,
      store,
      now,
    });

    // And a pre-0.3.0 install pinging the same day still counts alongside it,
    // which is the whole reason both shapes are accepted.
    await ping(store, 1, "0.2.9", now);

    const rollup = await store.rollUpDay(OTHER_DAY);
    expect(rollup.activeInstalls).toBe(2);
    expect(rollup.byArch).toEqual({ arm64: 1, x64: 1 });

    // The digest is still HMAC'd at rest — hashing client-side does not mean
    // the server stores what it received.
    expect(hashInstallId(HASH_SECRET, digest)).not.toBe(digest);
  });
});
