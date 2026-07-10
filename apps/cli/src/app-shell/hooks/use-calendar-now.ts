import { useEffect, useState } from "react";

/** Refresh cadence for calendar "now" chips (today / airing status). */
export const CALENDAR_NOW_INTERVAL_MS = 60_000;

/**
 * Wall-clock stamp for calendar browse rows. When `paused` (e.g. root overlay
 * input suspension), the interval is not scheduled so background ticks do not
 * re-render under a modal.
 */
export function useCalendarNow(paused: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setNow(Date.now()), CALENDAR_NOW_INTERVAL_MS);
    return () => clearInterval(id);
  }, [paused]);
  return now;
}
