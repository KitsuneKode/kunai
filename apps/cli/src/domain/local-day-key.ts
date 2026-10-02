/**
 * `YYYY-MM-DD` on the user's local calendar.
 *
 * Watch stats, streaks, and calendar rows are local-day concepts — "most active
 * day" means the user's day, not the UTC day. `toISOString().slice(0, 10)`
 * silently reports the *previous* day for every UTC+ timezone, so any surface
 * comparing against SQL `'localtime'` buckets must produce keys from here.
 */
export function localDayKey(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}
