/**
 * The one place an instant becomes a day label.
 *
 * Ingest, the cron and the public read endpoints all have to agree on what day
 * it is. They used to answer separately — `utcDayKey`, `snapshotDayKey`, and an
 * inline `today` in the cron — and a disagreement between them means the cron
 * rolls up a day that holds no rows. All three route through here.
 */

/**
 * The first instant labelled in IST: 00:00 IST on 15 September 2026, which is
 * 18:30 UTC on the 14th. Before it, labels are UTC; from it, IST.
 *
 * This must stay an exact IST midnight, and it must still be in the future when
 * the change reaches production. A deploy that lands after it relabels at deploy
 * time instead of on a known date, and a revert past it moves labels backwards
 * into a day that is already closed. Both are in the plan's risk table.
 */
export const IST_DAY_BOUNDARY_FROM = Date.parse("2026-09-14T18:30:00.000Z");

/** India observes no DST, so a fixed offset is exactly `Asia/Kolkata`. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Label of the day containing `now`. */
export function analyticsDayKey(now: number = Date.now()): string {
  const shifted = now >= IST_DAY_BOUNDARY_FROM ? now + IST_OFFSET_MS : now;
  return new Date(shifted).toISOString().slice(0, 10);
}

/**
 * Label of the most recent complete day — the one the cron publishes and the
 * public endpoints read.
 *
 * Stepping back one label rather than 24 hours of wall clock is what makes this
 * right across the seam, where the day before a 24-hour IST day is an
 * 18.5-hour one.
 */
export function previousAnalyticsDayKey(now: number = Date.now()): string {
  return shiftDayKey(analyticsDayKey(now), -1);
}

/** Shift a `YYYY-MM-DD` label by whole days. Pure arithmetic; reads no clock. */
export function shiftDayKey(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
