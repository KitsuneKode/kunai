import { useStdout } from "ink";
import { useEffect, useRef, useState } from "react";

import {
  getShellViewportPolicy,
  type ShellTerminalProfile,
  type ShellViewportKind,
  type ShellViewportPolicy,
} from "./layout-policy";

const RESIZE_DEBOUNCE_MS = 120;
type ShellEnv = Record<string, string | undefined>;

export type ViewportDimensions = {
  readonly cols: number;
  readonly rows: number;
};

/**
 * Sanitize a terminal dimension to a usable positive integer. When the
 * controlling terminal closes, `process.stdout.columns`/`rows` can report `0`
 * (which `?? fallback` does NOT catch) or `NaN` — and a size-0 re-render feeds
 * the shell layout zero/degenerate widths. Guarding here keeps dimensions sane
 * so the closed-terminal path can never drive a zero-size render.
 */
export function sanitizeDimension(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

export function getShellTerminalProfile(env: ShellEnv = process.env): ShellTerminalProfile {
  if (env.SSH_CONNECTION || env.SSH_TTY || env.TMUX || env.STY) return "constrained";
  if (/^(?:screen|tmux)(?:-|$)/i.test(env.TERM ?? "")) return "constrained";
  return "local";
}

/** Shrink on either axis settles immediately so layout never overflows a smaller terminal. */
export function shouldSettleViewportImmediately(
  settled: ViewportDimensions,
  next: ViewportDimensions,
): boolean {
  return next.cols < settled.cols || next.rows < settled.rows;
}

export function useShellDimensions(): ViewportDimensions {
  const { stdout } = useStdout();
  const [size, setSize] = useState<ViewportDimensions>(() => ({
    cols: sanitizeDimension(stdout.columns, 80),
    rows: sanitizeDimension(stdout.rows, 24),
  }));

  useEffect(() => {
    const onResize = () => {
      setSize({
        cols: sanitizeDimension(stdout.columns, 80),
        rows: sanitizeDimension(stdout.rows, 24),
      });
    };
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  return size;
}

/**
 * Returns a live viewport policy that re-evaluates on every terminal resize.
 * Ink re-renders when terminal size changes, so this hook is automatically reactive.
 */
export function useViewportPolicy(
  kind: ShellViewportKind,
  options: { forceCompact?: boolean; zen?: boolean } = {},
): ShellViewportPolicy {
  const { cols, rows } = useShellDimensions();
  return getShellViewportPolicy(kind, cols, rows, {
    ...options,
    terminalProfile: getShellTerminalProfile(),
  });
}

/**
 * Returns a viewport policy that settles immediately on terminal shrink and
 * debounces grow-only resizes for RESIZE_DEBOUNCE_MS to avoid companion thrash.
 */
export function useDebouncedViewportPolicy(
  kind: ShellViewportKind,
  options: { forceCompact?: boolean; zen?: boolean } = {},
): ShellViewportPolicy {
  const { cols, rows } = useShellDimensions();
  const [settled, setSettled] = useState({ cols, rows });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (cols === settled.cols && rows === settled.rows) return;

    if (shouldSettleViewportImmediately(settled, { cols, rows })) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setSettled({ cols, rows });
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setSettled({ cols, rows });
      timerRef.current = null;
    }, RESIZE_DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [cols, rows, settled]);

  return getShellViewportPolicy(kind, settled.cols, settled.rows, {
    ...options,
    terminalProfile: getShellTerminalProfile(),
  });
}

export const __testing = {
  RESIZE_DEBOUNCE_MS,
  shouldSettleViewportImmediately,
};
