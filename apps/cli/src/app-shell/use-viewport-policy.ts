import { useStdout } from "ink";
import { useEffect, useRef, useState } from "react";

import {
  getShellViewportPolicy,
  type ShellViewportKind,
  type ShellViewportPolicy,
} from "./layout-policy";

const RESIZE_DEBOUNCE_MS = 120;

/**
 * Returns a live viewport policy that re-evaluates on every terminal resize.
 * Ink re-renders when terminal size changes, so this hook is automatically reactive.
 */
export function useViewportPolicy(
  kind: ShellViewportKind,
  options: { forceCompact?: boolean } = {},
): ShellViewportPolicy {
  const { stdout } = useStdout();
  return getShellViewportPolicy(kind, stdout.columns ?? 80, stdout.rows ?? 24, options);
}

/**
 * Returns a debounced viewport policy that only settles after the user stops
 * resizing for RESIZE_DEBOUNCE_MS. Prevents rapid layout thrashing during
 * continuous resize drags.
 *
 * The policy is computed immediately on mount (no initial delay), but subsequent
 * dimension changes are coalesced.
 */
export function useDebouncedViewportPolicy(
  kind: ShellViewportKind,
  options: { forceCompact?: boolean } = {},
): ShellViewportPolicy {
  const { stdout } = useStdout();
  const cols = stdout.columns ?? 80;
  const rows = stdout.rows ?? 24;

  const [settled, setSettled] = useState({ cols, rows });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (cols === settled.cols && rows === settled.rows) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setSettled({ cols, rows });
      timerRef.current = null;
    }, RESIZE_DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [cols, rows, settled.cols, settled.rows]);

  return getShellViewportPolicy(kind, settled.cols, settled.rows, options);
}
