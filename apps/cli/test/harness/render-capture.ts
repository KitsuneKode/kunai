// =============================================================================
// Render-capture + flicker harness (Wave-0 tooling, F1; Wave-2 input bridge)
//
// Renders any Ink surface to a plain-text FRAME at controlled terminal widths,
// so layout breaks and flicker are SEEN in committed snapshots / diffs instead
// of guessed. Built on Ink's own `render` (debug mode writes whole frames
// synchronously) with a width-configurable stdout — ink-testing-library hard-
// codes columns=100 and cannot vary width.
//
// Capabilities:
//   • captureFrame / captureSurface — final frame at narrow/medium/wide.
//   • countCommits — flicker probe: how many frames an IDLE surface emits.
//     A calm surface settles to ONE frame; repeated commits with no state
//     change are the flicker we are hunting (loader desync, poster ghosting,
//     palette paging dance — see X1).
//   • captureResizeSequence — drive useStdout's `resize` event across widths.
//   • render() — long-lived handle with rerender + stdin bridge + width
//     retention. Use this when a test needs to drive `useInput` handlers or
//     change props without paying the mount cost twice. Mirrors the
//     `ink-testing-library` shape (lastFrame, rerender, stdin, stdout,
//     unmount) so anyone familiar with that library gets the API for free —
//     the only thing the local harness adds is `width` retention on rerender
//     and a real `stdin.enqueue` that pushes a chunk + emits `'readable'`
//     (Ink's App subscribes to `readable`, not `data`).
//
// Why we deliberately do NOT use `ink-testing-library`:
//   • It hardcodes columns=100, so we cannot test 72/140-rail collapse cases.
//   • Its `Stdout.columns` is a getter, not a setter, so we cannot simulate
//     resize.
//   • It has no flicker probe (frames[] yes, but no commit/diff report).
//   • We still wanted `rerender` and `stdin.write`, so the parts worth
//     keeping were ported here as `render()` + `stdin.enqueue`. Everything
//     else is custom. See `.docs/testing-strategy.md` for the full rationale.
//
// No app-shell imports here: agents pass their own component + prop fixture.
// =============================================================================

import { EventEmitter } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { render as inkRender } from "ink";
import { act, type ReactElement } from "react";

// Enable React 19's act-aware test mode so state updates from `emit('resize')`,
// `stdin.enqueue`, and any effect that fires during a rerender are flushed
// inside `act(...)` boundaries. Without this Bun emits
// "The current testing environment is not configured to support act(...)"
// and React 19 emits "An update to Root inside a test was not wrapped in
// act(...)". Setting the global here makes the warning an actual test
// failure (when one is missed) instead of a permanent noisy log.
//
// IMPORTANT: must run before the first `react` import. Bun hoists module
// evaluation, so this is the first statement in the file on purpose.
if ((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT !== true) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
}

/** Canonical capture widths — narrow (rail collapses), medium, wide (two-pane). */
export const CAPTURE_WIDTHS = { narrow: 72, medium: 100, wide: 140 } as const;
export type CaptureWidth = keyof typeof CAPTURE_WIDTHS;

const CAPTURE_DIR = path.join(import.meta.dir, "..", "__captures__");
const DEFAULT_ROWS = 45; // ≥ blocked floor (20); tall enough for full surfaces

/**
 * Width-configurable, frame-capturing stdout stand-in for Ink's `render`.
 *
 * `columns` and `rows` are PUBLIC so tests can shrink the terminal between
 * commits and watch the surface re-layout. Ink's `resized` reads them
 * directly off the stream (see ink/build/ink.js:262-263), so setting
 * `stdout.columns = 60` and then `emit("resize")` correctly triggers
 * `useStdout` subscribers to re-render at the new width.
 */
class CaptureStdout extends EventEmitter {
  readonly frames: string[] = [];
  private last = "";
  isTTY = true;
  constructor(
    public columns: number,
    public rows: number,
  ) {
    super();
  }
  write = (frame: string): boolean => {
    this.frames.push(frame);
    this.last = frame;
    return true;
  };
  lastFrame = (): string => this.last;
}

/**
 * Minimal TTY stdin that:
 *   - satisfies Ink's TTY checks (`isTTY: true`, `setRawMode()`)
 *   - implements `read()` returning queued chunks (Ink's App subscribes to
 *     `readable` and calls `read()` in a loop — see ink/build/components/
 *     App.js:175-179)
 *   - exposes `enqueue(data)` that pushes a string and emits `'readable'`
 *     so `useInput` callbacks fire on test-driven keys.
 *
 * Single-character writes (the common case for a key press) become a single
 * `read()` chunk, which the Ink input parser then turns into one keypress
 * event. Multi-character sequences (escape codes, paste simulation) are
 * passed through as-is.
 */
class CaptureStdin extends EventEmitter {
  private buffer: string[] = [];
  isTTY = true;
  setRawMode(): void {}
  setEncoding(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
  read(): string | null {
    return this.buffer.shift() ?? null;
  }
  /** No-op kept for API parity with the real stream; tests use enqueue(). */
  write(): void {}
  /** Push one or more chunks into the readable buffer and notify Ink. */
  enqueue(data: string | readonly string[]): void {
    const chunks = Array.isArray(data) ? [...data] : [data];
    for (const chunk of chunks) {
      if (chunk.length > 0) this.buffer.push(chunk);
    }
    this.emit("readable");
  }
}

export interface CaptureOptions {
  readonly columns?: number;
  readonly rows?: number;
}

interface MountedCapture {
  readonly stdout: CaptureStdout;
  readonly stdin: CaptureStdin;
  unmount(): void;
}

function mount(node: ReactElement, options: CaptureOptions = {}): MountedCapture {
  const stdout = new CaptureStdout(
    options.columns ?? CAPTURE_WIDTHS.medium,
    options.rows ?? DEFAULT_ROWS,
  );
  const stdin = new CaptureStdin();
  let instance: { unmount(): void };
  act(() => {
    instance = inkRender(node, {
      // Cast: our stand-ins implement the slice of the stream API Ink touches.
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      debug: true, // synchronous whole-frame writes → lastFrame is the clean frame
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true, // enable resize handling in CI/non-TTY harness runs
    });
  });
  return {
    stdout,
    stdin,
    unmount: () => {
      act(() => {
        instance.unmount();
      });
    },
  };
}

export type CaptureResizeStep = CaptureOptions;

/**
 * Mount once, apply each resize step in order, and return the frame after every
 * step. Emits Ink's stdout `resize` event when dimensions change.
 */
export function captureResizeSequence(
  node: ReactElement,
  steps: readonly CaptureResizeStep[],
): string[] {
  if (steps.length === 0) return [];

  const first = steps[0];
  if (!first) return [];
  const stdout = new CaptureStdout(
    first.columns ?? CAPTURE_WIDTHS.medium,
    first.rows ?? DEFAULT_ROWS,
  );
  const stdin = new CaptureStdin();
  let instance: { unmount(): void };
  act(() => {
    instance = inkRender(node, {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
    });
  });

  const frames: string[] = [];
  try {
    for (const step of steps) {
      const nextColumns = step.columns ?? stdout.columns;
      const nextRows = step.rows ?? stdout.rows;
      if (nextColumns !== stdout.columns || nextRows !== stdout.rows) {
        stdout.columns = nextColumns;
        stdout.rows = nextRows;
        act(() => {
          stdout.emit("resize");
        });
      }
      frames.push(stdout.lastFrame().replace(/\s+$/, ""));
    }
    return frames;
  } finally {
    act(() => {
      instance.unmount();
    });
  }
}

/** Render `node` at one width and return its final text frame (trailing blank lines trimmed). */
export function captureFrame(node: ReactElement, options: CaptureOptions = {}): string {
  const active = mount(node, options);
  try {
    return active.stdout.lastFrame().replace(/\s+$/, "");
  } finally {
    active.unmount();
  }
}

/** Render `node` at all three canonical widths. */
export function captureAllWidths(
  node: ReactElement,
  rows = DEFAULT_ROWS,
): Record<CaptureWidth, string> {
  return {
    narrow: captureFrame(node, { columns: CAPTURE_WIDTHS.narrow, rows }),
    medium: captureFrame(node, { columns: CAPTURE_WIDTHS.medium, rows }),
    wide: captureFrame(node, { columns: CAPTURE_WIDTHS.wide, rows }),
  };
}

/**
 * Write `<surface>.<width>.txt` snapshots into `test/__captures__/` for every
 * width. Read these (or diff them in review) to catch broken layouts before
 * wiring. Returns the written file paths.
 */
export async function captureSurface(
  surface: string,
  node: ReactElement,
  rows = DEFAULT_ROWS,
): Promise<string[]> {
  await mkdir(CAPTURE_DIR, { recursive: true });
  const frames = captureAllWidths(node, rows);
  const written: string[] = [];
  for (const width of Object.keys(frames) as CaptureWidth[]) {
    const file = path.join(CAPTURE_DIR, `${surface}.${width}.txt`);
    const header = `# ${surface} · ${width} (${CAPTURE_WIDTHS[width]}×${rows})\n`;
    await writeFile(file, `${header}${frames[width]}\n`, "utf8");
    written.push(file);
  }
  return written;
}

export interface CommitReport {
  /** Total frames Ink committed during the window. */
  readonly commits: number;
  /** Distinct frame strings — > 1 at idle means visible flicker. */
  readonly distinctFrames: number;
}

/**
 * Flicker probe. Mount `node`, idle for `durationMs`, and report how many
 * frames Ink committed and how many were distinct. A calm surface yields
 * `{ commits: 1, distinctFrames: 1 }`; timers/effects that re-render with no
 * user input show up as extra distinct frames.
 *
 * NOTE: this measures real-time scheduling and is therefore inherently
 * timing-dependent. For deterministic assertions on interval-driven surfaces
 * use {@link simulateTicks} instead.
 */
export async function countCommits(
  node: ReactElement,
  {
    columns = CAPTURE_WIDTHS.wide,
    rows = DEFAULT_ROWS,
    durationMs = 250,
  }: CaptureOptions & { durationMs?: number } = {},
): Promise<CommitReport> {
  const active = mount(node, { columns, rows });
  try {
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    return {
      commits: active.stdout.frames.length,
      distinctFrames: new Set(active.stdout.frames).size,
    };
  } finally {
    active.unmount();
  }
}

// ---------------------------------------------------------------------------
// render() — long-lived handle for rerender + stdin bridge
// ---------------------------------------------------------------------------

/**
 * stdin handle exposed on the result of {@link render}. Mirrors the
 * `ink-testing-library` `instance.stdin` shape (it had `write()` and that
 * is the only thing it could do). We rename it to `enqueue` to make it
 * clear that we are pushing a raw chunk into the read buffer and emitting
 * `'readable'` — NOT pretending to be a TTY from the OS's point of view.
 */
export interface RenderStdin {
  /** Push a chunk (e.g. `"q"`, `"\r"`, `"\x1b[A"`, `"hello"`) and notify Ink. */
  enqueue(data: string | readonly string[]): void;
  /** True when a chunk is queued and not yet read by Ink's App. */
  readonly buffered: boolean;
}

/**
 * Result of {@link render}. Kept intentionally close to the
 * `ink-testing-library` `Instance` shape (lastFrame, rerender, unmount,
 * stdin, stdout, frames) so anyone who has used that library can port
 * a test in seconds. Differences:
 *   - `width` is remembered and re-applied on `rerender` so width
 *     assertions don't drift across prop changes.
 *   - `stdin` exposes `enqueue` (a real chunk) instead of `write` (a
 *     silent no-op for our capture stream).
 */
export interface RenderHandle {
  readonly stdout: CaptureStdout;
  readonly stdin: RenderStdin;
  readonly width: number;
  readonly rows: number;
  /** Last committed frame string (same as `stdout.lastFrame()`). */
  lastFrame(): string;
  /** All frames Ink has committed in order, including the initial mount. */
  readonly frames: readonly string[];
  /**
   * Re-mount the component with a new tree. Width and rows are preserved.
   * The previously-rendered instance is unmounted first so React's effect
   * cleanup (timers, subscriptions) runs before the next tree mounts.
   */
  rerender(next: ReactElement): void;
  /** Unmount the current tree and detach all listeners. Idempotent. */
  unmount(): void;
}

function asRenderStdin(stdin: CaptureStdin): RenderStdin {
  return {
    enqueue: (data) => {
      act(() => {
        stdin.enqueue(data);
      });
    },
    get buffered() {
      return (stdin as unknown as { buffer: string[] }).buffer.length > 0;
    },
  };
}

/**
 * Mount `node` and return a handle. Prefer this over {@link captureFrame}
 * when the test needs to:
 *   - change props and assert on the new frame (use `rerender`)
 *   - drive `useInput` from the test (use `stdin.enqueue`)
 *   - measure commits across multiple keystrokes (read `frames`)
 *
 * The handle owns one mounted Ink instance at a time. Calling `rerender`
 * unmounts the previous tree and mounts the new one synchronously inside
 * `act()`. The frame accumulator is preserved across rerenders so a test
 * that asserts "rerender produced exactly N new frames" can compute
 * `frames.length` deltas. Each remount produces exactly 2 commits: the
 * final frame of the previous tree (if any non-empty frame was rendered)
 * and the initial frame of the new tree.
 */
export function render(node: ReactElement, options: CaptureOptions = {}): RenderHandle {
  let columns = options.columns ?? CAPTURE_WIDTHS.medium;
  let rows = options.rows ?? DEFAULT_ROWS;
  let active = mount(node, { columns, rows });
  let unmounted = false;
  // Accumulated frame history across remounts. The active stdout owns live
  // frames after stdin/timer updates; `committedFrameCount` marks how many of
  // that stream's frames have already been copied into `settledFrames`.
  let liveStdout: CaptureStdout = active.stdout;
  let liveStdin: CaptureStdin = active.stdin;
  const settledFrames: string[] = [];
  let committedFrameCount = 0;

  const flushLiveFrames = () => {
    const nextFrames = liveStdout.frames.slice(committedFrameCount);
    if (nextFrames.length > 0) {
      settledFrames.push(...nextFrames);
      committedFrameCount = liveStdout.frames.length;
    }
  };

  const remount = (next: ReactElement) => {
    if (unmounted) {
      throw new Error("render: cannot rerender after unmount");
    }
    flushLiveFrames();
    active.unmount();
    active = mount(next, { columns, rows });
    liveStdout = active.stdout;
    liveStdin = active.stdin;
    committedFrameCount = 0;
  };

  return {
    get stdout() {
      return liveStdout;
    },
    get stdin() {
      return asRenderStdin(liveStdin);
    },
    width: columns,
    rows: rows,
    lastFrame() {
      return liveStdout.lastFrame();
    },
    get frames() {
      return [...settledFrames, ...liveStdout.frames.slice(committedFrameCount)];
    },
    rerender(next) {
      remount(next);
    },
    unmount() {
      if (unmounted) return;
      unmounted = true;
      active.unmount();
    },
  };
}

// ---------------------------------------------------------------------------
// Deterministic timer simulation
// ---------------------------------------------------------------------------

/**
 * Run a render for a fixed number of synthetic "ticks" without sleeping.
 * Each tick is a single `act()` boundary during which the test controls
 * what advances (e.g. a `setInterval` callback that mutates a `useState`
 * setter via a registered handle). This is the deterministic replacement
 * for {@link countCommits} when the surface is interval-driven.
 *
 * Use case: assert that a loader commits exactly one frame per tick and
 * never two frames for the same state. Real-time `countCommits` can flake
 * when a tick fires between two frames; this helper cannot.
 *
 * The test registers a tick source up front, then `simulateTicks` runs
 * the registered tick N times. Pass `null` as the tick source to assert
 * idle (no state changes) for N iterations.
 */
export interface SimulateTicksOptions {
  /** Number of `act()` rounds to run. Defaults to 5. */
  readonly rounds?: number;
  /**
   * Invoked inside each `act()` round. Use this to fire whatever your
   * component uses to advance (e.g. a setInterval callback). Return
   * `false` from any round to stop early. The default `() => {}` is
   * equivalent to "no work" — useful for idle assertions.
   */
  readonly tick?: () => void | boolean;
  readonly columns?: number;
  readonly rows?: number;
}

export interface SimulateTicksReport {
  readonly commits: number;
  readonly distinctFrames: number;
}

export function simulateTicks(
  node: ReactElement,
  { rounds = 5, tick, columns, rows }: SimulateTicksOptions = {},
): SimulateTicksReport {
  const initialColumns = columns ?? CAPTURE_WIDTHS.medium;
  const initialRows = rows ?? DEFAULT_ROWS;
  const stdout = new CaptureStdout(initialColumns, initialRows);
  const stdin = new CaptureStdin();
  let instance: { unmount(): void };

  // Replace setInterval/setTimeout with deterministic shims that fire once
  // per `act()` round. Each registered interval's callback runs at the
  // start of the next round; if a callback returns `false`, the interval
  // is cleared. This lets us drive interval-driven components (loaders,
  // tickers, polling) without any real-time scheduling, so the resulting
  // frame count is exactly `1 (mount) + rounds` (or fewer if a callback
  // returns false).
  const intervals = new Map<number, { cb: () => void | boolean; ms: number; cleared: boolean }>();
  let intervalId = 0;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const shimSetInterval = ((cb: () => void | boolean, _ms?: number, ..._args: unknown[]) => {
    const id = ++intervalId;
    intervals.set(id, { cb, ms: _ms ?? 0, cleared: false });
    return id as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;
  const shimClearInterval = ((id: ReturnType<typeof setInterval>) => {
    const handle = intervals.get(id as unknown as number);
    if (handle) handle.cleared = true;
  }) as typeof clearInterval;
  // setTimeout stays real — components use it for debounced commits, and
  // those still need the test to await something. `simulateTicks` doesn't
  // await; tests that need setTimeout control should use a separate helper.
  globalThis.setInterval = shimSetInterval;
  globalThis.clearInterval = shimClearInterval;

  try {
    act(() => {
      instance = inkRender(node, {
        stdout: stdout as unknown as NodeJS.WriteStream,
        stdin: stdin as unknown as NodeJS.ReadStream,
        debug: true,
        exitOnCtrlC: false,
        patchConsole: false,
        interactive: true,
      });
    });
    let shouldStop = false;
    for (let i = 0; i < rounds; i++) {
      act(() => {
        // Fire any custom tick callback first (lets a test inject extra
        // state changes alongside the interval firing).
        if (tick) {
          const result = tick();
          if (result === false) shouldStop = true;
        }
        // Then fire every active interval once. A callback that returns
        // false clears itself.
        for (const [, handle] of intervals) {
          if (handle.cleared) continue;
          const result = handle.cb();
          if (result === false) {
            handle.cleared = true;
          }
        }
      });
      if (shouldStop) break;
    }
    return {
      commits: stdout.frames.length,
      distinctFrames: new Set(stdout.frames).size,
    };
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    act(() => {
      instance.unmount();
    });
  }
}
