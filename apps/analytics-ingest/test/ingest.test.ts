import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import {
  ANALYTICS_PAYLOAD_KEYS,
  hashInstallId,
  ingestAnalyticsPing,
  isTimestampSkewed,
  parseAnalyticsPayload,
  TS_SKEW_MS,
  utcDayKey,
} from "../src/ingest";
import { createMemoryAnalyticsStore } from "../src/memory-store";

const HASH_SECRET = "test-analytics-hash-secret-not-for-prod";
const NOW = Date.UTC(2026, 7, 14, 12, 0, 0);

const valid = {
  installId: "11111111-2222-4333-8444-555555555555",
  version: "0.3.0",
  os: "linux",
  arch: "x64",
  ts: NOW,
};

describe("payload contract", () => {
  test("accepts only the exact five keys", () => {
    expect(Object.keys(valid).sort()).toEqual([...ANALYTICS_PAYLOAD_KEYS]);
    expect(parseAnalyticsPayload(valid)).toEqual(valid);
    expect(parseAnalyticsPayload({ ...valid, title: "nope" })).toBeNull();
    expect(parseAnalyticsPayload({ ...valid, query: "dune" })).toBeNull();
    // The `extra` seam is a database column only; no wire field ships with it.
    expect(parseAnalyticsPayload({ ...valid, extra: {} })).toBeNull();
    const { arch: _arch, ...missing } = valid;
    expect(parseAnalyticsPayload(missing)).toBeNull();
  });

  test("rejects dimension values outside the allowlists", () => {
    expect(parseAnalyticsPayload({ ...valid, os: "haiku" })).toBeNull();
    expect(parseAnalyticsPayload({ ...valid, arch: "sparc" })).toBeNull();
    expect(parseAnalyticsPayload({ ...valid, version: "not-semver" })).toBeNull();
  });

  test("hashInstallId is HMAC-SHA256 hex and never contains the raw UUID", () => {
    const hashed = hashInstallId(HASH_SECRET, valid.installId);
    expect(hashed).toHaveLength(64);
    expect(hashed).not.toContain(valid.installId);
    expect(hashed).toBe(
      createHmac("sha256", HASH_SECRET).update(valid.installId, "utf8").digest("hex"),
    );
  });

  test("rejects clock skew beyond 24h", () => {
    expect(isTimestampSkewed(NOW, NOW)).toBe(false);
    expect(isTimestampSkewed(NOW - TS_SKEW_MS - 1, NOW)).toBe(true);
  });
});

describe("ingestAnalyticsPing", () => {
  test("records one row and reports the day", async () => {
    const store = createMemoryAnalyticsStore();
    const result = await ingestAnalyticsPing({
      method: "POST",
      body: valid,
      hashSecret: HASH_SECRET,
      store,
      now: NOW,
    });
    expect(result).toEqual({ ok: true, day: utcDayKey(NOW), stored: true });
    expect(store.rawCount()).toBe(1);
  });

  test("two pings from the same install on the same day yield one row", async () => {
    const store = createMemoryAnalyticsStore();
    for (let i = 0; i < 5; i += 1) {
      await ingestAnalyticsPing({
        method: "POST",
        body: valid,
        hashSecret: HASH_SECRET,
        store,
        now: NOW,
      });
    }
    expect(store.rawCount()).toBe(1);
    const rollup = await store.rollUpDay(utcDayKey(NOW));
    expect(rollup.activeInstalls).toBe(1);
  });

  test("dimensions actually reach the rollup", async () => {
    // The defect this replaces: version/os/arch were validated then discarded.
    const store = createMemoryAnalyticsStore();
    const bodies = [
      valid,
      { ...valid, installId: "aaaaaaaa-2222-4333-8444-555555555555", os: "darwin" },
      { ...valid, installId: "bbbbbbbb-2222-4333-8444-555555555555", version: "0.2.5" },
    ];
    for (const body of bodies) {
      await ingestAnalyticsPing({ method: "POST", body, hashSecret: HASH_SECRET, store, now: NOW });
    }
    const rollup = await store.rollUpDay(utcDayKey(NOW));
    expect(rollup.activeInstalls).toBe(3);
    expect(rollup.byVersion).toEqual({ "0.3.0": 2, "0.2.5": 1 });
    expect(rollup.byOs).toEqual({ linux: 2, darwin: 1 });
    expect(rollup.byArch).toEqual({ x64: 3 });
    expect(rollup.lifetimeInstalls).toBe(3);
  });

  test("rejects a bad payload, non-POST, and a missing secret", async () => {
    const store = createMemoryAnalyticsStore();
    await expect(
      ingestAnalyticsPing({ method: "GET", body: valid, hashSecret: HASH_SECRET, store, now: NOW }),
    ).resolves.toEqual({ ok: false, status: 405, error: "method_not_allowed" });
    await expect(
      ingestAnalyticsPing({ method: "POST", body: valid, hashSecret: "", store, now: NOW }),
    ).resolves.toEqual({ ok: false, status: 503, error: "misconfigured" });
    await expect(
      ingestAnalyticsPing({
        method: "POST",
        body: { ...valid, title: "x" },
        hashSecret: HASH_SECRET,
        store,
        now: NOW,
      }),
    ).resolves.toEqual({ ok: false, status: 400, error: "invalid_payload" });
    expect(store.rawCount()).toBe(0);
  });

  test("a skewed clock is rejected before anything is stored", async () => {
    const store = createMemoryAnalyticsStore();
    const result = await ingestAnalyticsPing({
      method: "POST",
      body: { ...valid, ts: NOW - TS_SKEW_MS - 1 },
      hashSecret: HASH_SECRET,
      store,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, status: 400, error: "timestamp_skew" });
    expect(store.rawCount()).toBe(0);
  });
});

describe("retention", () => {
  test("pruneRawBefore removes only older days", async () => {
    const store = createMemoryAnalyticsStore();
    await store.recordPing({
      day: "2026-06-01",
      installHash: "old",
      version: "0.3.0",
      os: "linux",
      arch: "x64",
    });
    await store.recordPing({
      day: "2026-08-14",
      installHash: "new",
      version: "0.3.0",
      os: "linux",
      arch: "x64",
    });
    expect(await store.pruneRawBefore("2026-07-10")).toBe(1);
    expect(store.rawCount()).toBe(1);
  });
});
