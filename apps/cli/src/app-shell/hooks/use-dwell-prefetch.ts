import { useEffect } from "react";

/**
 * "The row has been rested on long enough that Enter is likely" threshold.
 * Deliberately longer than {@link PREVIEW_SETTLE_MS} (150ms): preview work is
 * cosmetic and cheap to abort, while entry prefetch pays real provider/catalog
 * cost — it should only fire once navigation has genuinely stopped.
 */
export const PREFETCH_DWELL_MS = 500;

/**
 * Fire `onPrefetch` after `value` stops changing for `dwellMs`. Latest-wins by
 * construction: a new value aborts the in-flight prefetch before re-arming, so
 * a navigation burst never leaves stale warms running behind the cursor.
 *
 * The callback runs fire-and-forget — it owns its own error containment, and
 * the timer never touches component state, so prefetch can never block or
 * re-render the list under the user's keys.
 */
export function useDwellPrefetch<T>(
  value: T | undefined,
  onPrefetch: ((value: T, signal: AbortSignal) => void) | undefined,
  dwellMs: number = PREFETCH_DWELL_MS,
): void {
  useEffect(() => {
    if (value === undefined || !onPrefetch) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      try {
        onPrefetch(value, controller.signal);
      } catch {
        // Prefetch is silent by contract — a throwing callback must not kill
        // the shell it was warming.
      }
    }, dwellMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, onPrefetch, dwellMs]);
}
