/**
 * The v2 wire shape, accepted alongside v1 rather than instead of it.
 *
 * Every published client treats a 4xx as permanent for 24 hours, so the
 * property that matters most is that nothing which works today starts failing:
 * v1 UUIDs, v1 digests, and v2 all have to be accepted by the same deploy.
 */

import { describe, expect, test } from "bun:test";

import { analyticsDayKey, shiftDayKey } from "../src/analytics-day";
import {
  ANALYTICS_PAYLOAD_KEYS,
  ANALYTICS_PAYLOAD_V2_KEYS,
  hashInstallId,
  ingestAnalyticsPing,
  isDayLabelInWindow,
  parseAnalyticsPayload,
} from "../src/ingest";
import { DEFAULT_ANALYTICS_LIMITS } from "../src/limits";
import { createMemoryAnalyticsStore } from "../src/memory-store";
import { ALLOWED_OS, isValidCohort, isValidDayLabel } from "../src/payload-validation";

const HASH_SECRET = "test-analytics-hash-secret-not-for-prod";
/** 12:00 UTC on 14 November 2026: 17:30 IST, so the ingest label is the 14th. */
const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);
const TODAY = analyticsDayKey(NOW);

const v1Uuid = {
  installId: "11111111-2222-4333-8444-555555555555",
  version: "0.2.9",
  os: "linux",
  arch: "x64",
  ts: NOW,
};
const v1Digest = { ...v1Uuid, installId: "ab".repeat(32), version: "0.3.0" };
const v2 = {
  id: "cd".repeat(32),
  cohort: "2026-10",
  day: TODAY,
  version: "0.5.0",
  os: "linux",
  arch: "arm64",
};

type WireBody = Readonly<Record<string, string | number>>;

function ingest(body: WireBody, store = createMemoryAnalyticsStore()) {
  return ingestAnalyticsPing({ method: "POST", body, hashSecret: HASH_SECRET, store, now: NOW });
}

describe("every shape a client sends today keeps working", () => {
  test("v1 UUID, v1 digest and v2 are all accepted by one ingest", async () => {
    const store = createMemoryAnalyticsStore();
    for (const body of [v1Uuid, v1Digest, v2]) {
      expect(await ingest(body, store)).toEqual({
        ok: true,
        day: TODAY,
        stored: true,
        duplicate: false,
      });
    }
    expect(store.rawCount()).toBe(3);
    const rollup = await store.rollUpDay(TODAY);
    expect(rollup.activeInstalls).toBe(3);
    expect(rollup.byVersion).toEqual({ "0.2.9": 1, "0.3.0": 1, "0.5.0": 1 });
  });

  test("the key lists are exactly the two wire shapes", () => {
    expect(Object.keys(v1Uuid).sort()).toEqual([...ANALYTICS_PAYLOAD_KEYS]);
    expect(Object.keys(v2).sort()).toEqual([...ANALYTICS_PAYLOAD_V2_KEYS]);
  });

  test("v2 parses into its own shape, with the id lower-cased", () => {
    expect(parseAnalyticsPayload({ ...v2, id: v2.id.toUpperCase() })).toEqual({ wire: 2, ...v2 });
  });

  test("v2 never writes install_lifetime; v1 still does", async () => {
    const store = createMemoryAnalyticsStore();
    await ingest(v2, store);
    expect(store.lifetimeCount()).toBe(0);
    await ingest(v1Digest, store);
    expect(store.lifetimeCount()).toBe(1);
    // Both count toward the month.
    expect(store.monthActiveCount()).toBe(2);
  });
});

describe("the v2 key set is closed", () => {
  test("a seventh key is rejected, as a sixth is for v1", async () => {
    for (const extra of [{ title: "dune" }, { ts: NOW }, { installId: v1Uuid.installId }]) {
      expect(parseAnalyticsPayload({ ...v2, ...extra })).toBeNull();
    }
    expect(await ingest({ ...v2, query: "x" })).toEqual({
      ok: false,
      status: 400,
      error: "invalid_payload",
    });
  });

  test("a v1 body with a sixth key is still rejected", () => {
    expect(parseAnalyticsPayload({ ...v1Uuid, cohort: "2026-10" })).toBeNull();
    expect(parseAnalyticsPayload({ ...v1Uuid, day: TODAY })).toBeNull();
  });

  test("a missing v2 key is rejected", () => {
    for (const key of ANALYTICS_PAYLOAD_V2_KEYS) {
      const body = Object.fromEntries(Object.entries(v2).filter(([name]) => name !== key));
      expect(parseAnalyticsPayload(body)).toBeNull();
    }
  });

  test("a v2 id must be a 64-hex digest, never a UUID", () => {
    expect(parseAnalyticsPayload({ ...v2, id: v1Uuid.installId })).toBeNull();
    expect(parseAnalyticsPayload({ ...v2, id: "a".repeat(63) })).toBeNull();
  });
});

describe("the v2 day label", () => {
  test("within a day of the ingest's own label is accepted", async () => {
    for (const offset of [-1, 0, 1]) {
      const day = shiftDayKey(TODAY, offset);
      const result = await ingest({ ...v2, day, id: `${offset + 1}`.repeat(64) });
      expect(result.ok).toBe(true);
    }
  });

  test("out of the window is rejected before anything is written", async () => {
    const store = createMemoryAnalyticsStore();
    for (const day of [shiftDayKey(TODAY, -2), shiftDayKey(TODAY, 2), "2025-01-01"]) {
      expect(await ingest({ ...v2, day, cohort: "2024-01" }, store)).toEqual({
        ok: false,
        status: 400,
        error: "day_out_of_window",
      });
    }
    expect(store.pingWrites()).toBe(0);
  });

  test("the window is computed from labels, not from 24 hours of wall clock", () => {
    expect(isDayLabelInWindow("2026-11-13", "2026-11-14")).toBe(true);
    expect(isDayLabelInWindow("2026-11-12", "2026-11-14")).toBe(false);
    expect(isDayLabelInWindow("2026-12-01", "2026-11-30")).toBe(true);
  });

  test("an impossible calendar day is not a day label", () => {
    expect(isValidDayLabel("2026-02-29")).toBe(false);
    expect(isValidDayLabel("2028-02-29")).toBe(true);
    expect(isValidDayLabel("2026-11-14T00:00")).toBe(false);
    expect(parseAnalyticsPayload({ ...v2, day: "2026-11-31" })).toBeNull();
  });
});

describe("the v2 cohort", () => {
  test("is a YYYY-MM month no earlier than 2024-01", () => {
    expect(isValidCohort("2024-01")).toBe(true);
    expect(isValidCohort("2023-12")).toBe(false);
    expect(isValidCohort("2026-13")).toBe(false);
    expect(isValidCohort("2026-1")).toBe(false);
  });

  test("cannot postdate the ping that reports it", () => {
    expect(parseAnalyticsPayload({ ...v2, cohort: "2026-11" })).not.toBeNull();
    expect(parseAnalyticsPayload({ ...v2, cohort: "2026-12" })).toBeNull();
    expect(parseAnalyticsPayload({ ...v2, cohort: "2023-12" })).toBeNull();
  });

  test("a client a day ahead into a new month may report that month", async () => {
    const day = "2026-12-01";
    const now = Date.UTC(2026, 10, 30, 12, 0, 0);
    expect(analyticsDayKey(now)).toBe("2026-11-30");
    const result = await ingestAnalyticsPing({
      method: "POST",
      body: { ...v2, day, cohort: "2026-12" },
      hashSecret: HASH_SECRET,
      store: createMemoryAnalyticsStore(),
      now,
    });
    expect(result.ok).toBe(true);
  });
});

describe("android", () => {
  test("is an allowed os for v1 and v2", async () => {
    expect(ALLOWED_OS).toContain("android");
    expect((await ingest({ ...v1Digest, os: "android" })).ok).toBe(true);
    expect((await ingest({ ...v2, os: "android" })).ok).toBe(true);
  });

  test("the os allowlist is still closed", () => {
    expect(parseAnalyticsPayload({ ...v2, os: "ios" })).toBeNull();
    expect(parseAnalyticsPayload({ ...v2, os: "Android" })).toBeNull();
  });
});

/**
 * Finding M3 of the 2026-11 security review: the budget row was updated before
 * the ceiling was checked, so every over-budget request still wrote.
 */
describe("the admission budget", () => {
  const limits = { ...DEFAULT_ANALYTICS_LIMITS, maxPingsPerDay: 2 };
  const ping = (n: number) => ({ ...v1Digest, installId: String(n).repeat(64) });

  test("an over-budget request performs no write", async () => {
    const store = createMemoryAnalyticsStore(limits);
    await ingest(ping(1), store);
    await ingest(ping(2), store);
    const writes = store.pingWrites();
    expect(store.budgetSpent(TODAY)).toBe(2);

    const refused = await ingest(ping(3), store);
    expect(refused).toEqual({ ok: true, day: TODAY, stored: false, duplicate: false });
    expect(store.pingWrites()).toBe(writes);
    expect(store.budgetSpent(TODAY)).toBe(2);
    expect(store.rawCount()).toBe(2);
    expect(store.monthActiveCount()).toBe(2);
  });

  test("a repeat ping spends no budget and writes nothing", async () => {
    const store = createMemoryAnalyticsStore(limits);
    await ingest(ping(1), store);
    const writes = store.pingWrites();
    for (let i = 0; i < 5; i += 1) {
      expect(await ingest(ping(1), store)).toEqual({
        ok: true,
        day: TODAY,
        stored: true,
        duplicate: true,
      });
    }
    expect(store.pingWrites()).toBe(writes);
    expect(store.budgetSpent(TODAY)).toBe(1);
    // A retrying client no longer crowds out a second install.
    expect((await ingest(ping(2), store)).ok).toBe(true);
    expect(store.rawCount()).toBe(2);
  });

  test("the hash input is the id the client sent, so v1 counts are unchanged", () => {
    expect(hashInstallId(HASH_SECRET, v1Digest.installId)).toHaveLength(64);
    expect(hashInstallId(HASH_SECRET, v1Digest.installId)).not.toBe(
      hashInstallId(HASH_SECRET, v1Uuid.installId),
    );
  });
});
