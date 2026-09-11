/**
 * The day clock, and the seam it crosses.
 *
 * Ingest, the cron and the public read endpoints have to agree on what day it
 * is. Every clock here is expressed relative to `IST_DAY_BOUNDARY_FROM` rather
 * than as a separately typed date, so the constant and the tests cannot drift
 * apart.
 */
import { describe, expect, test } from "bun:test";

import {
  analyticsDayKey,
  IST_DAY_BOUNDARY_FROM,
  previousAnalyticsDayKey,
  shiftDayKey,
} from "../src/analytics-day";
import { ingestAnalyticsPing } from "../src/ingest";
import { createMemoryAnalyticsStore } from "../src/memory-store";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const IST_OFFSET_MS = (5 * 60 + 30) * MINUTE_MS;

describe("analyticsDayKey", () => {
  test("the cutover is an exact IST midnight", () => {
    // If this drifts, the seam stops being a single short day.
    expect(new Date(IST_DAY_BOUNDARY_FROM + IST_OFFSET_MS).toISOString()).toEndWith(
      "T00:00:00.000Z",
    );
  });

  test("one millisecond before the cutover still labels in UTC", () => {
    expect(analyticsDayKey(IST_DAY_BOUNDARY_FROM - 1)).toBe("2026-09-14");
  });

  test("the cutover instant opens the first IST day", () => {
    expect(analyticsDayKey(IST_DAY_BOUNDARY_FROM)).toBe("2026-09-15");
  });

  test("an IST day rolls over at 18:30 UTC, not midnight UTC", () => {
    const lastInstant = Date.parse("2026-09-20T18:29:59.999Z");
    expect(analyticsDayKey(lastInstant)).toBe("2026-09-20");
    expect(analyticsDayKey(lastInstant + 1)).toBe("2026-09-21");
  });

  test("labels never move backwards across the seam", () => {
    let previous = "";
    for (
      let t = IST_DAY_BOUNDARY_FROM - 8 * HOUR_MS;
      t <= IST_DAY_BOUNDARY_FROM + 8 * HOUR_MS;
      t += 5 * MINUTE_MS
    ) {
      const label = analyticsDayKey(t);
      expect(label >= previous).toBe(true);
      previous = label;
    }
  });

  test("the seam day is the short one", () => {
    // 2026-09-14 runs 00:00Z to 18:30Z only: 18.5 hours, not 24.
    expect(analyticsDayKey(Date.parse("2026-09-14T00:00:00Z"))).toBe("2026-09-14");
    expect(analyticsDayKey(IST_DAY_BOUNDARY_FROM - 1)).toBe("2026-09-14");
    expect(analyticsDayKey(IST_DAY_BOUNDARY_FROM)).toBe("2026-09-15");
  });
});

describe("previousAnalyticsDayKey", () => {
  test("at 19:00 UTC after the cutover it returns the just-closed IST day", () => {
    expect(previousAnalyticsDayKey(Date.parse("2026-09-15T19:00:00Z"))).toBe("2026-09-15");
  });

  test("the first post-cutover run publishes the seam day", () => {
    expect(previousAnalyticsDayKey(Date.parse("2026-09-14T19:00:00Z"))).toBe("2026-09-14");
  });

  test("before the cutover it matches the now-minus-24h formula it replaces", () => {
    // The behaviour the old snapshotDayKey had, so nothing shifts before the seam.
    for (const instant of [
      Date.parse("2026-08-14T00:05:00Z"),
      Date.parse("2026-08-14T23:59:59Z"),
      IST_DAY_BOUNDARY_FROM - HOUR_MS,
    ]) {
      const legacy = new Date(instant - 24 * HOUR_MS).toISOString().slice(0, 10);
      expect(previousAnalyticsDayKey(instant)).toBe(legacy);
    }
  });
});

describe("shiftDayKey", () => {
  test("moves whole days without reading a clock", () => {
    expect(shiftDayKey("2026-09-15", -35)).toBe("2026-08-11");
    expect(shiftDayKey("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("ingest labels through the shared clock", () => {
  async function ingestAt(now: number) {
    return await ingestAnalyticsPing({
      method: "POST",
      hashSecret: "test-secret",
      store: createMemoryAnalyticsStore(),
      now,
      body: {
        installId: "11111111-2222-4333-8444-555555555555",
        version: "0.3.0",
        os: "linux",
        arch: "x64",
        // Matching `now` keeps the skew guard out of the way; the day label is
        // taken from the server clock, never from this field.
        ts: now,
      },
    });
  }

  test("a ping just before the cutover lands on the UTC label", async () => {
    expect(await ingestAt(IST_DAY_BOUNDARY_FROM - 1)).toMatchObject({
      ok: true,
      day: "2026-09-14",
    });
  });

  test("a ping at the cutover lands on the first IST label", async () => {
    expect(await ingestAt(IST_DAY_BOUNDARY_FROM)).toMatchObject({
      ok: true,
      day: "2026-09-15",
    });
  });
});
