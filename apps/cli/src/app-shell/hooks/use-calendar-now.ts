import { useEffect, useState } from "react";

/** Refresh cadence for calendar "now" chips (today / airing status). */
export const CALENDAR_NOW_INTERVAL_MS = 60_000;

/**
 * Wall-clock stamp for schedule rows. Non-calendar browse sessions do not need
 * a minute timer, so keep that recurring work out of the common search path.
 */
export function useCalendarNow(enabled: boolean, suspended = false): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled || suspended) return;
    const id = setInterval(() => setNow(Date.now()), CALENDAR_NOW_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled, suspended]);

  return now;
}
