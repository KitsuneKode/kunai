import { describe, expect, test } from "bun:test";

import {
  createMemoryDailyDistinctStore,
  createMemoryRateLimitStore,
  ingestTelemetryPing,
  parseTelemetryPayload,
  TELEMETRY_PAYLOAD_KEYS,
} from "../src/ingest";

const valid = {
  installId: "11111111-2222-4333-8444-555555555555",
  version: "0.3.0",
  os: "linux",
  arch: "x64",
  ts: Date.UTC(2026, 6, 20),
};

describe("telemetry ingest privacy contract", () => {
  test("accepts only the exact payload keys", () => {
    expect(Object.keys(valid).sort()).toEqual([...TELEMETRY_PAYLOAD_KEYS]);
    expect(parseTelemetryPayload(valid)).toEqual(valid);
    expect(parseTelemetryPayload({ ...valid, title: "nope" })).toBeNull();
    expect(parseTelemetryPayload({ ...valid, query: "dune" })).toBeNull();
  });

  test("POST only; rate-limits by ephemeral IP key; counts distinct install ids", () => {
    const rateLimit = createMemoryRateLimitStore({ windowMs: 60_000, maxPerWindow: 2 });
    const daily = createMemoryDailyDistinctStore();
    const now = Date.UTC(2026, 6, 20);

    expect(
      ingestTelemetryPing({
        method: "GET",
        body: valid,
        ipKey: "1.2.3.4",
        now,
        rateLimit,
        daily,
      }),
    ).toEqual({ ok: false, status: 405, error: "method_not_allowed" });

    expect(
      ingestTelemetryPing({
        method: "POST",
        body: valid,
        ipKey: "1.2.3.4",
        now,
        rateLimit,
        daily,
      }),
    ).toEqual({ ok: true, day: "2026-07-20", distinct: 1 });

    expect(
      ingestTelemetryPing({
        method: "POST",
        body: { ...valid, installId: "22222222-2222-4333-8444-555555555555" },
        ipKey: "1.2.3.4",
        now,
        rateLimit,
        daily,
      }),
    ).toEqual({ ok: true, day: "2026-07-20", distinct: 2 });

    expect(
      ingestTelemetryPing({
        method: "POST",
        body: valid,
        ipKey: "1.2.3.4",
        now,
        rateLimit,
        daily,
      }),
    ).toEqual({ ok: false, status: 429, error: "rate_limited" });

    expect(daily.count("2026-07-20")).toBe(2);
  });
});
