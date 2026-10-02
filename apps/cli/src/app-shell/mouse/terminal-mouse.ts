// =============================================================================
// terminal-mouse.ts — SGR mouse tracking: enable/disable sequences and the
// incremental parser for `ESC [ < Cb ; Cx ; Cy (M|m)` reports.
//
// Pure module — no Ink, no process globals. The stdin proxy (mouse-stdin.ts)
// owns the stream plumbing; this file only knows bytes → events.
// =============================================================================

/** Enable: button press/release + drag (1002) + SGR extended coords (1006). */
export const MOUSE_TRACKING_ENABLE = "\x1b[?1000h\x1b[?1002h\x1b[?1006h";
/** Disable in reverse order; harmless if the modes were never on. */
export const MOUSE_TRACKING_DISABLE = "\x1b[?1006l\x1b[?1002l\x1b[?1000l";

export type MouseButton = "left" | "middle" | "right" | "wheel-up" | "wheel-down" | "none";

export type MouseEvent = {
  /** Terminal column, 1-based. */
  readonly x: number;
  /** Terminal row, 1-based. */
  readonly y: number;
  readonly button: MouseButton;
  /** press | release (SGR `m` final) | drag (motion bit) | wheel tick. */
  readonly kind: "press" | "release" | "drag" | "wheel";
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
};

// ESC is built from a char code so no literal control byte sits in the source
// (oxlint no-control-regex); see app-shell/line-editor.ts for the convention.
const ESC = String.fromCharCode(27);
const SGR_MOUSE_PATTERN = new RegExp(`${ESC}\\[<(\\d+);(\\d+);(\\d+)([Mm])`, "g");
/** `\x1b[<…` without a terminator yet — a sequence split across chunks. */
const SGR_MOUSE_PARTIAL = new RegExp(`${ESC}\\[<[0-9;]*$`);
const SGR_MOUSE_EXACT = new RegExp(`^${ESC}\\[<(\\d+);(\\d+);(\\d+)([Mm])$`);

type DecodedButton = {
  readonly button: MouseButton;
  readonly kind: MouseEvent["kind"];
};

function decodeButton(code: number): DecodedButton {
  const wheel = (code & 64) !== 0;
  const motion = (code & 32) !== 0;
  const base = code & 3;

  if (wheel) {
    return {
      button: (code & 1) === 0 ? "wheel-up" : "wheel-down",
      kind: "wheel",
    };
  }
  // SGR release is signalled by the `m` final byte, not by Cb — Cb keeps the
  // released button's number (unlike legacy X10 where Cb&3==3 meant release).
  const button: MouseButton =
    base === 0 ? "left" : base === 1 ? "middle" : base === 2 ? "right" : "none";
  return { button, kind: motion ? "drag" : "press" };
}

export function parseSgrMouseSequence(sequence: string): MouseEvent | null {
  const match = SGR_MOUSE_EXACT.exec(sequence);
  if (!match) return null;
  const code = Number(match[1]);
  const x = Number(match[2]);
  const y = Number(match[3]);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 1 || y < 1) return null;
  const { button, kind } = decodeButton(code);
  return {
    x,
    y,
    button,
    kind: match[4] === "m" && kind !== "wheel" ? "release" : kind,
    ctrl: (code & 16) !== 0,
    shift: (code & 4) !== 0,
    alt: (code & 8) !== 0,
  };
}

export type MouseSplitResult = {
  /** Bytes that are plain input — deliver these to Ink untouched. */
  readonly input: string;
  readonly events: readonly MouseEvent[];
  /** Trailing bytes that look like a sequence cut off mid-chunk. */
  readonly pendingTail: string;
};

/**
 * Split one stdin chunk into mouse events and the remaining input bytes.
 * Caller owns `pendingTail` stitching: prepend it to the next chunk before
 * calling again.
 */
export function splitMouseSequences(chunk: string): MouseSplitResult {
  const events: MouseEvent[] = [];
  let input = "";
  let lastIndex = 0;
  for (const match of chunk.matchAll(SGR_MOUSE_PATTERN)) {
    input += chunk.slice(lastIndex, match.index);
    const event = parseSgrMouseSequence(match[0]);
    if (event) events.push(event);
    lastIndex = match.index + match[0].length;
  }
  const tail = chunk.slice(lastIndex);
  const partial = SGR_MOUSE_PARTIAL.exec(tail);
  if (partial) {
    input += tail.slice(0, partial.index);
    return { input, events, pendingTail: partial[0] };
  }
  return { input: input + tail, events, pendingTail: "" };
}
