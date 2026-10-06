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

/**
 * Structural subset of Ink's stdout — anything emitting "resize" with
 * columns/rows. Tests drive it with a bare EventEmitter.
 */
export type ResizeSource = {
  readonly columns?: number;
  readonly rows?: number;
  on(event: "resize", listener: () => void): void;
  off(event: "resize", listener: () => void): void;
};

type ResizeSubscriber = (next: ViewportDimensions) => void;

type ResizeHub = {
  readonly subs: Set<ResizeSubscriber>;
  readonly listener: () => void;
  last: ViewportDimensions;
};

export function readStdoutDimensions(stdout: ResizeSource): ViewportDimensions {
  return {
    cols: sanitizeDimension(stdout.columns, 80),
    rows: sanitizeDimension(stdout.rows, 24),
  };
}

/**
 * One "resize" listener per stdout object, shared by every component asking
 * for dimensions. Each mounted `useShellDimensions` used to attach its own
 * listener, and routine overlay stacking (browse + library + palette + a
 * couple of InputFields) crossed EventEmitter's 10-listener threshold — Bun
 * writes `MaxListenersExceededWarning` to stderr, straight into the alternate
 * screen. The hub also dedupes: a SIGWINCH that leaves columns/rows unchanged
 * no longer re-renders N subtrees.
 */
const resizeHubs = new WeakMap<ResizeSource, ResizeHub>();

export function subscribeStdoutResize(stdout: ResizeSource, onNext: ResizeSubscriber): () => void {
  let hub = resizeHubs.get(stdout);
  if (!hub) {
    const created: ResizeHub = {
      subs: new Set(),
      last: readStdoutDimensions(stdout),
      listener() {
        const next = readStdoutDimensions(stdout);
        if (next.cols === created.last.cols && next.rows === created.last.rows) return;
        created.last = next;
        for (const sub of created.subs) sub(next);
      },
    };
    stdout.on("resize", created.listener);
    resizeHubs.set(stdout, created);
    hub = created;
  }
  hub.subs.add(onNext);
  return () => {
    hub.subs.delete(onNext);
    if (hub.subs.size === 0) {
      stdout.off("resize", hub.listener);
      resizeHubs.delete(stdout);
    }
  };
}

export function useShellDimensions(): ViewportDimensions {
  const { stdout } = useStdout();
  const [size, setSize] = useState<ViewportDimensions>(() => readStdoutDimensions(stdout));

  useEffect(() => subscribeStdoutResize(stdout, setSize), [stdout]);

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
