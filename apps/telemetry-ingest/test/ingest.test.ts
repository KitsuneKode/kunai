import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import {
  createMemoryDailyDistinctStore,
  createMemoryInstallDayGate,
  createMemoryLifetimeStore,
  createMemoryRateLimitStore,
  hashInstallId,
  ingestTelemetryPing,
  isTimestampSkewed,
  parseTelemetryPayload,
  TELEMETRY_PAYLOAD_KEYS,
  TS_SKEW_MS,
} from "../src/ingest";

const HASH_SECRET = "test-telemetry-hash-secret-not-for-prod";

const valid = {
  installId: "11111111-2222-4333-8444-555555555555",
  version: "0.3.0",
  os: "linux",
  arch: "x64",
  ts: Date.UTC(2026, 6, 20, 12, 0, 0),
};

describe("telemetry ingest privacy contract", () => {
  test("accepts only the exact payload keys", () => {
    expect(Object.keys(valid).sort()).toEqual([...TELEMETRY_PAYLOAD_KEYS]);
    expect(parseTelemetryPayload(valid)).toEqual(valid);
    expect(parseTelemetryPayload({ ...valid, title: "nope" })).toBeNull();
    expect(parseTelemetryPayload({ ...valid, query: "dune" })).toBeNull();
  });

  test("hashInstallId is HMAC-SHA256 hex and never returns the raw UUID", () => {
    const hashed = hashInstallId(HASH_SECRET, valid.installId);
    expect(hashed).not.toContain(valid.installId);
    expect(hashed).toHaveLength(64);
    expect(hashed).toBe(
      createHmac("sha256", HASH_SECRET).update(valid.installId, "utf8").digest("hex"),
    );
  });

  test("rejects timestamps outside ±24h of server now", () => {
    const now = Date.UTC(2026, 6, 20, 12, 0, 0);
    expect(isTimestampSkewed(now, now)).toBe(false);
    expect(isTimestampSkewed(now - TS_SKEW_MS, now)).toBe(false);
    expect(isTimestampSkewed(now + TS_SKEW_MS, now)).toBe(false);
    expect(isTimestampSkewed(now - TS_SKEW_MS - 1, now)).toBe(true);
    expect(isTimestampSkewed(now + TS_SKEW_MS + 1, now)).toBe(true);
  });

  test("POST only; IP rate-limit; hashes install ids; one count per installHash per day", async () => {
    const rateLimit = createMemoryRateLimitStore({ windowMs: 60_000, maxPerWindow: 10 });
    const installDayGate = createMemoryInstallDayGate();
    const daily = createMemoryDailyDistinctStore();
    const lifetime = createMemoryLifetimeStore();
    const now = Date.UTC(2026, 6, 20, 12, 0, 0);

    expect(
      await ingestTelemetryPing({
        method: "GET",
        body: valid,
        ipKey: "1.2.3.4",
        now,
        hashSecret: HASH_SECRET,
        rateLimit,
        installDayGate,
        daily,
        lifetime,
      }),
    ).toEqual({ ok: false, status: 405, error: "method_not_allowed" });

    expect(
      await ingestTelemetryPing({
        method: "POST",
        body: valid,
        ipKey: "1.2.3.4",
        now,
        hashSecret: HASH_SECRET,
        rateLimit,
        installDayGate,
        daily,
        lifetime,
      }),
    ).toEqual({ ok: true, day: "2026-07-20", distinct: 1 });

    // Same install again same day — accepted at IP layer but does not double-count.
    expect(
      await ingestTelemetryPing({
        method: "POST",
        body: valid,
        ipKey: "1.2.3.4",
        now: now + 1_000,
        hashSecret: HASH_SECRET,
        rateLimit,
        installDayGate,
        daily,
        lifetime,
      }),
    ).toEqual({ ok: true, day: "2026-07-20", distinct: 1, alreadyCounted: true });

    expect(
      await ingestTelemetryPing({
        method: "POST",
        body: { ...valid, installId: "22222222-2222-4333-8444-555555555555" },
        ipKey: "1.2.3.4",
        now: now + 2_000,
        hashSecret: HASH_SECRET,
        rateLimit,
        installDayGate,
        daily,
        lifetime,
      }),
    ).toEqual({ ok: true, day: "2026-07-20", distinct: 2 });

    expect(daily.count("2026-07-20")).toBe(2);
    expect(lifetime.approxCount()).toBe(2);
    // Daily store must never contain the raw UUID.
    expect(daily.debugMembers?.("2026-07-20") ?? []).not.toContain(valid.installId);
  });

  test("rejects skewed ts", async () => {
    const rateLimit = createMemoryRateLimitStore();
    const installDayGate = createMemoryInstallDayGate();
    const daily = createMemoryDailyDistinctStore();
    const lifetime = createMemoryLifetimeStore();
    const now = Date.UTC(2026, 6, 20, 12, 0, 0);

    expect(
      await ingestTelemetryPing({
        method: "POST",
        body: { ...valid, ts: now - TS_SKEW_MS - 1 },
        ipKey: "9.9.9.9",
        now,
        hashSecret: HASH_SECRET,
        rateLimit,
        installDayGate,
        daily,
        lifetime,
      }),
    ).toEqual({ ok: false, status: 400, error: "timestamp_skew" });
  });

  test("IP rate limit returns 429", async () => {
    const rateLimit = createMemoryRateLimitStore({ windowMs: 60_000, maxPerWindow: 1 });
    const installDayGate = createMemoryInstallDayGate();
    const daily = createMemoryDailyDistinctStore();
    const lifetime = createMemoryLifetimeStore();
    const now = Date.UTC(2026, 6, 20, 12, 0, 0);

    expect(
      (
        await ingestTelemetryPing({
          method: "POST",
          body: valid,
          ipKey: "1.2.3.4",
          now,
          hashSecret: HASH_SECRET,
          rateLimit,
          installDayGate,
          daily,
          lifetime,
        })
      ).ok,
    ).toBe(true);

    expect(
      await ingestTelemetryPing({
        method: "POST",
        body: { ...valid, installId: "33333333-2222-4333-8444-555555555555" },
        ipKey: "1.2.3.4",
        now: now + 1,
        hashSecret: HASH_SECRET,
        rateLimit,
        installDayGate,
        daily,
        lifetime,
      }),
    ).toEqual({ ok: false, status: 429, error: "rate_limited" });
  });
});
