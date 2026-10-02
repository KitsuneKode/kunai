import { describe, expect, test } from "bun:test";

import {
  MOUSE_TRACKING_DISABLE,
  MOUSE_TRACKING_ENABLE,
  parseSgrMouseSequence,
  splitMouseSequences,
} from "../../../../src/app-shell/mouse/terminal-mouse";

describe("parseSgrMouseSequence", () => {
  test("parses a left-button press with coordinates", () => {
    expect(parseSgrMouseSequence("\x1b[<0;12;5M")).toEqual({
      x: 12,
      y: 5,
      button: "left",
      kind: "press",
      ctrl: false,
      shift: false,
      alt: false,
    });
  });

  test("parses middle and right button presses", () => {
    expect(parseSgrMouseSequence("\x1b[<1;3;4M")?.button).toBe("middle");
    expect(parseSgrMouseSequence("\x1b[<2;3;4M")?.button).toBe("right");
  });

  test("release uses the `m` final byte and keeps the released button", () => {
    const event = parseSgrMouseSequence("\x1b[<0;12;5m");
    expect(event?.kind).toBe("release");
    // SGR keeps the released button in Cb — 0 is left, not "none".
    expect(event?.button).toBe("left");
    const right = parseSgrMouseSequence("\x1b[<2;12;5m");
    expect(right).toMatchObject({ kind: "release", button: "right" });
  });

  test("parses wheel ticks (bit 6)", () => {
    const up = parseSgrMouseSequence("\x1b[<64;10;3M");
    const down = parseSgrMouseSequence("\x1b[<65;10;3M");
    expect(up).toMatchObject({ kind: "wheel", button: "wheel-up" });
    expect(down).toMatchObject({ kind: "wheel", button: "wheel-down" });
  });

  test("parses modifier bits: shift=4, alt=8, ctrl=16", () => {
    const event = parseSgrMouseSequence("\x1b[<28;1;1M"); // 4|8|16
    expect(event).toMatchObject({ shift: true, alt: true, ctrl: true, kind: "press" });
  });

  test("parses drag reports (bit 32)", () => {
    const event = parseSgrMouseSequence("\x1b[<32;7;9M");
    expect(event).toMatchObject({ button: "left", kind: "drag" });
  });

  test("rejects malformed sequences", () => {
    expect(parseSgrMouseSequence("\x1b[<;1;1M")).toBeNull();
    expect(parseSgrMouseSequence("\x1b[0;1;1M")).toBeNull();
    expect(parseSgrMouseSequence("hello")).toBeNull();
    expect(parseSgrMouseSequence("\x1b[<0;0;0M")).toBeNull(); // 0,0 is off-screen
  });
});

describe("splitMouseSequences", () => {
  test("separates a mouse report from surrounding key bytes", () => {
    const { input, events, pendingTail } = splitMouseSequences("a\x1b[<0;5;2Mb");
    expect(input).toBe("ab");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ x: 5, y: 2, kind: "press" });
    expect(pendingTail).toBe("");
  });

  test("handles a press+release pair in one chunk", () => {
    const { input, events } = splitMouseSequences("\x1b[<0;9;1M\x1b[<0;9;1m");
    expect(input).toBe("");
    expect(events.map((event) => event.kind)).toEqual(["press", "release"]);
  });

  test("holds a sequence split across chunks as pendingTail", () => {
    const first = splitMouseSequences("k\x1b[<0;12");
    expect(first.input).toBe("k");
    expect(first.pendingTail).toBe("\x1b[<0;12");
    const second = splitMouseSequences(first.pendingTail + ";4M");
    expect(second.input).toBe("");
    expect(second.events[0]).toMatchObject({ x: 12, y: 4, kind: "press" });
  });

  test("passes non-mouse CSI through untouched", () => {
    // Cursor-position report — starts \x1b[ but is not a mouse sequence.
    const { input, events } = splitMouseSequences("\x1b[24;80R");
    expect(input).toBe("\x1b[24;80R");
    expect(events).toHaveLength(0);
  });

  test("a bare Escape byte stays in the input stream", () => {
    const { input } = splitMouseSequences("\x1b");
    expect(input).toBe("\x1b");
  });

  test("strips an X10 report that a stale tracking mode can still emit", () => {
    // \x1b[M + three value+32 bytes (button 0, col 5, row 2 → 32/37/34).
    const { input, events } = splitMouseSequences('a\x1b[M %"b');
    expect(input).toBe("ab");
    expect(events).toHaveLength(0);
  });

  test("strips a urxvt report (no SGR < prefix)", () => {
    const { input, events } = splitMouseSequences("a\x1b[35;10;20Mb");
    expect(input).toBe("ab");
    expect(events).toHaveLength(0);
  });

  test("an X10 report split across chunks is held, not released as keys", () => {
    const first = splitMouseSequences("k\x1b[M %");
    expect(first.input).toBe("k");
    expect(first.pendingTail).toBe("\x1b[M %");
    // Third payload byte arrives next chunk.
    const second = splitMouseSequences(`${first.pendingTail}"`);
    expect(second.input).toBe("");
    expect(second.events).toHaveLength(0);
  });

  test("a lone ESC [ M with no payload is still a tail, not a keypress", () => {
    const { input, pendingTail } = splitMouseSequences("x\x1b[M");
    expect(input).toBe("x");
    expect(pendingTail).toBe("\x1b[M");
  });

  test("tracking sequences are reversible ANSI toggles", () => {
    expect(MOUSE_TRACKING_ENABLE).toBe("\x1b[?1000h\x1b[?1002h\x1b[?1006h");
    expect(MOUSE_TRACKING_DISABLE).toBe("\x1b[?1006l\x1b[?1002l\x1b[?1000l");
  });
});
