// =============================================================================
// Render-capture + flicker harness (Wave-0 tooling, F1)
//
// Renders any Ink surface to a plain-text FRAME at controlled terminal widths,
// so layout breaks and flicker are SEEN in committed snapshots / diffs instead
// of guessed. Built on Ink's own `render` (debug mode writes whole frames
// synchronously) with a width-configurable stdout — ink-testing-library hard-
// codes columns=100 and cannot vary width.
//
// Two capabilities:
//   • captureFrame / captureSurface — final frame at narrow/medium/wide.
//   • countCommits — flicker probe: how many frames an IDLE surface emits.
//     A calm surface settles to ONE frame; repeated commits with no state
//     change are the flicker we are hunting (loader desync, poster ghosting,
//     palette paging dance — see X1).
//
// No app-shell imports here: agents pass their own component + prop fixture.
// =============================================================================

import { EventEmitter } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { render as inkRender } from "ink";
import type { ReactElement } from "react";

/** Canonical capture widths — narrow (rail collapses), medium, wide (two-pane). */
export const CAPTURE_WIDTHS = { narrow: 72, medium: 100, wide: 140 } as const;
export type CaptureWidth = keyof typeof CAPTURE_WIDTHS;

const CAPTURE_DIR = path.join(import.meta.dir, "..", "__captures__");
const DEFAULT_ROWS = 45; // ≥ blocked floor (20); tall enough for full surfaces

/** Width-configurable, frame-capturing stdout stand-in for Ink's `render`. */
class CaptureStdout extends EventEmitter {
  readonly frames: string[] = [];
  private last = "";
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

/** Minimal TTY stdin so surfaces using `useInput` mount without a real terminal. */
class CaptureStdin extends EventEmitter {
  isTTY = true;
  setRawMode(): void {}
  setEncoding(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
  read(): null {
    return null;
  }
  write(): void {}
}

export interface CaptureOptions {
  readonly columns?: number;
  readonly rows?: number;
}

interface ActiveCapture {
  readonly stdout: CaptureStdout;
  unmount(): void;
}

function mount(node: ReactElement, options: CaptureOptions = {}): ActiveCapture {
  const stdout = new CaptureStdout(
    options.columns ?? CAPTURE_WIDTHS.medium,
    options.rows ?? DEFAULT_ROWS,
  );
  const stdin = new CaptureStdin();
  const instance = inkRender(node, {
    // Cast: our stand-ins implement the slice of the stream API Ink touches.
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true, // synchronous whole-frame writes → lastFrame is the clean frame
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return { stdout, unmount: () => instance.unmount() };
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
