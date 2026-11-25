import { describe, expect, test } from "bun:test";

import {
  analyticsDayKey,
  analyticsMonthKey,
  IST_DAY_BOUNDARY_FROM,
  isAnalyticsMonth,
} from "@/domain/analytics/analytics-day";

import * as ingest from "../../../../../analytics-ingest/src/analytics-day";

/**
 * The client's `day` is checked by the ingest against its own clock, so the
 * two copies of the day rule must label every instant identically. The CLI
 * cannot import the ingest app (it is not part of the published package), so
 * the rule is duplicated and this test is what keeps the copy honest.
 */
describe("the client's day rule matches the ingest's", () => {
  test("same cutover instant", () => {
    expect(IST_DAY_BOUNDARY_FROM).toBe(ingest.IST_DAY_BOUNDARY_FROM);
  });

  const MINUTE = 60_000;
  const instants = [
    // Either side of the UTC→IST cutover, to the millisecond.
    IST_DAY_BOUNDARY_FROM - 1,
    IST_DAY_BOUNDARY_FROM,
    IST_DAY_BOUNDARY_FROM + 1,
    // Either side of an IST midnight that is also a month and a year boundary.
    Date.parse("2026-12-31T18:29:59.999Z"),
    Date.parse("2026-12-31T18:30:00.000Z"),
    // A UTC midnight, which is no longer a day boundary after the cutover.
    Date.parse("2026-11-30T23:59:59.999Z"),
    Date.parse("2026-12-01T00:00:00.000Z"),
    // Before the cutover, where UTC midnight is the boundary.
    Date.parse("2026-08-31T23:59:59.999Z"),
    Date.parse("2026-09-01T00:00:00.000Z"),
  ];
  // Every 37 minutes across two years: lands on every hour/minute offset.
  for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2028, 0, 1); t += 37 * MINUTE) instants.push(t);

  test("same label for every instant", () => {
    const mismatches = instants.filter((t) => analyticsDayKey(t) !== ingest.analyticsDayKey(t));
    expect(mismatches.map((t) => new Date(t).toISOString())).toEqual([]);
  });

  test("the month is the month of the day label, never a second clock reading", () => {
    // 00:10 IST on 1 January 2027 is still 31 December in UTC.
    const instant = Date.parse("2026-12-31T18:40:00.000Z");
    expect(analyticsDayKey(instant)).toBe("2027-01-01");
    expect(analyticsMonthKey(instant)).toBe("2027-01");
    for (const t of instants)
      expect(analyticsMonthKey(t)).toBe(ingest.analyticsDayKey(t).slice(0, 7));
  });

  test("a cohort label is a real month", () => {
    expect(isAnalyticsMonth("2026-11")).toBe(true);
    for (const bad of ["2026-13", "2026-00", "2026-1", "26-11", "2026-11-01", "", 202611, null]) {
      expect(isAnalyticsMonth(bad)).toBe(false);
    }
  });
});
