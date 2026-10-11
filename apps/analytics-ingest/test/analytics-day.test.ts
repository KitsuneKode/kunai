/**
 * The day clock, and the seam it crosses.
 *
 * Ingest, the cron and the public read endpoints have to agree on what day it
 * is. Every instant here is an offset from `IST_DAY_BOUNDARY_FROM`, and every
 * expected label is derived from it by plain UTC arithmetic — never typed as a
 * date. Moving the cutover therefore needs no edit here; what still names the
 * date (the docs-site caption and both analytics documents) has its own tests
 * that fail until it moves too.
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
import { snapshotDayKey } from "../src/public-metrics";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const IST_OFFSET_MS = (5 * 60 + 30) * MINUTE_MS;
const CUTOVER = IST_DAY_BOUNDARY_FROM;

/**
 * The UTC date of the cutover instant. The cutover falls at 18:30 UTC, so this
 * is the short changeover day: it opened at midnight UTC and closes at the
 * cutover. Read straight off the instant, independent of the offset logic
 * under test.
 */
const SEAM_DAY = new Date(CUTOVER).toISOString().slice(0, 10);

/** The first day on the IST grid, which opens at the cutover instant. */
const FIRST_IST_DAY = shiftDayKey(SEAM_DAY, 1);

describe("analyticsDayKey", () => {
  test("the cutover is an exact IST midnight", () => {
    // If this drifts, the seam stops being a single short day.
    expect(new Date(CUTOVER + IST_OFFSET_MS).toISOString()).toEndWith("T00:00:00.000Z");
  });

  test("one millisecond before the cutover still labels in UTC", () => {
    expect(analyticsDayKey(CUTOVER - 1)).toBe(SEAM_DAY);
  });

  test("the cutover instant opens the first IST day", () => {
    expect(analyticsDayKey(CUTOVER)).toBe(FIRST_IST_DAY);
  });

  test("an IST day rolls over at 18:30 UTC, not midnight UTC", () => {
    // Six days on, well clear of the seam: CUTOVER + 6 days is 18:30 UTC, and
    // it is the first instant of the next IST day.
    const rollover = CUTOVER + 6 * DAY_MS;
    expect(new Date(rollover).toISOString()).toEndWith("T18:30:00.000Z");
    expect(analyticsDayKey(rollover - 1)).toBe(shiftDayKey(FIRST_IST_DAY, 5));
    expect(analyticsDayKey(rollover)).toBe(shiftDayKey(FIRST_IST_DAY, 6));
  });

  test("labels never move backwards across the seam", () => {
    let previous = "";
    for (let t = CUTOVER - 8 * HOUR_MS; t <= CUTOVER + 8 * HOUR_MS; t += 5 * MINUTE_MS) {
      const label = analyticsDayKey(t);
      expect(label >= previous).toBe(true);
      previous = label;
    }
  });

  test("the seam day is the short one", () => {
    // It opens at midnight UTC and closes at the cutover: 18.5 hours, not 24.
    const seamOpens = Date.parse(`${SEAM_DAY}T00:00:00.000Z`);
    expect(CUTOVER - seamOpens).toBe(18.5 * HOUR_MS);
    expect(analyticsDayKey(seamOpens)).toBe(SEAM_DAY);
    expect(analyticsDayKey(CUTOVER - 1)).toBe(SEAM_DAY);
    expect(analyticsDayKey(CUTOVER)).toBe(FIRST_IST_DAY);
  });
});

describe("previousAnalyticsDayKey", () => {
  test("at 19:00 UTC after the cutover it returns the just-closed IST day", () => {
    // One day plus half an hour past the cutover: 19:00 UTC, 00:30 IST.
    expect(previousAnalyticsDayKey(CUTOVER + DAY_MS + 30 * MINUTE_MS)).toBe(FIRST_IST_DAY);
  });

  test("the first post-cutover run publishes the seam day", () => {
    expect(previousAnalyticsDayKey(CUTOVER + 30 * MINUTE_MS)).toBe(SEAM_DAY);
  });

  test("before the cutover it matches the now-minus-24h formula it replaces", () => {
    // The behaviour the old snapshotDayKey had, so nothing shifts before the seam.
    for (const instant of [
      CUTOVER - 31 * DAY_MS,
      CUTOVER - 30 * DAY_MS - MINUTE_MS,
      CUTOVER - HOUR_MS,
    ]) {
      const legacy = new Date(instant - DAY_MS).toISOString().slice(0, 10);
      expect(previousAnalyticsDayKey(instant)).toBe(legacy);
    }
  });
});

describe("shiftDayKey", () => {
  test("moves whole days without reading a clock", () => {
    // Pure label arithmetic: fixed strings are the point, and no clock is read.
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
    expect(await ingestAt(CUTOVER - 1)).toMatchObject({ ok: true, day: SEAM_DAY });
  });

  test("a ping at the cutover lands on the first IST label", async () => {
    expect(await ingestAt(CUTOVER)).toMatchObject({ ok: true, day: FIRST_IST_DAY });
  });
});

describe("snapshotDayKey follows the shared clock", () => {
  test("it resolves the same day the cron and the endpoints will roll up", () => {
    expect(snapshotDayKey(CUTOVER + DAY_MS + 30 * MINUTE_MS)).toBe(FIRST_IST_DAY);
    expect(snapshotDayKey(CUTOVER - 1)).toBe(shiftDayKey(SEAM_DAY, -1));
  });
});
