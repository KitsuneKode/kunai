import { useEffect, useState } from "react";

/**
 * Default "I've stopped on this row" debounce for preview-side work (poster
 * fetch, companion/detail resolution). Long enough that a run of ↑/↓ presses
 * never triggers a network fetch or renderer subprocess mid-navigation, short
 * enough that the preview feels responsive once you rest. Tune here.
 */
export const PREVIEW_SETTLE_MS = 150;

/**
 * Debounce `value` to when it stops changing for `delayMs`. The settled value is
 * seeded to the initial `value` so first paint is immediate; thereafter it lags
 * behind rapid changes and only catches up once they rest. Use it to gate heavy
 * per-selection work (poster downloads, chafa/Kitty subprocess spawns, detail
 * lookups) so the single-threaded event loop stays free to service keypresses.
 */
export function useSettledValue<T>(value: T, delayMs: number = PREVIEW_SETTLE_MS): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
