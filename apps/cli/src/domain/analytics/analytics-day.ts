/**
 * The client's copy of the ingest's day rule.
 *
 * The v2 ping sends `day`, and the ingest checks it against its own clock, so
 * the two have to label an instant the same way. The rule lives in
 * `apps/analytics-ingest/src/analytics-day.ts`; the CLI cannot import it
 * because that app is not part of the published package. This is a duplicate
 * on purpose, and `analytics-day-parity.test.ts` fails the moment the two
 * disagree about any instant.
 *
 * Months come from the day label, never from a second clock reading, so the
 * month a ping's `id` rotates on is always the month its `day` names.
 */

/** 00:00 IST on 15 September 2026. Before it labels are UTC; from it, IST. */
export const IST_DAY_BOUNDARY_FROM = Date.parse("2026-09-14T18:30:00.000Z");

/** India observes no DST, so a fixed offset is exactly `Asia/Kolkata`. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** `YYYY-MM-DD` of the analytics day containing `now`. */
export function analyticsDayKey(now: number): string {
  const shifted = now >= IST_DAY_BOUNDARY_FROM ? now + IST_OFFSET_MS : now;
  return new Date(shifted).toISOString().slice(0, 10);
}

/** `YYYY-MM` of the analytics day containing `now`. */
export function analyticsMonthKey(now: number): string {
  return analyticsDayKey(now).slice(0, 7);
}

/** True for a well-formed `YYYY-MM` cohort label. */
export function isAnalyticsMonth(value: string | undefined): value is string {
  return value !== undefined && MONTH_RE.test(value);
}
