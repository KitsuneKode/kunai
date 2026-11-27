import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { CompanionHost } from "@/app-shell/CompanionHost";
import { __testing as sprite, acquireKannaSprite, kannaSlot } from "@/app-shell/kanna-sprite";
import { kannaLinesFor } from "@/app-shell/kanna-voice";
import React, { act } from "react";

import { render, stripAnsi } from "../../harness/render-capture";

// What each tier puts on screen and on the wire. The tier is decided from the
// real environment and the real stdout, so each test sets both and restores
// them; the sprite's own I/O is stubbed so a graphics write is visible here.

const ENV_KEYS = [
  "KUNAI_PET",
  "KUNAI_PLAIN",
  "KUNAI_POSTER",
  "KUNAI_REDUCED_MOTION",
  "KUNAI_IMAGE_PROTOCOL",
  "NO_COLOR",
  "NO_MOTION",
  "KITTY_WINDOW_ID",
  "TERM",
  "TERM_PROGRAM",
  "TMUX",
  "STY",
  "SSH_CONNECTION",
  "SSH_TTY",
] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const savedIsTTY = process.stdout.isTTY;
const savedRuntime = { ...sprite.runtime };

let spriteWrites: string[];
let stdoutWrites: string[];
let restoreStdout: () => void;

function setTTY(value: boolean): void {
  Object.defineProperty(process.stdout, "isTTY", { value, configurable: true, writable: true });
}

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  // Lines arrive whole: the type-on is a reaction, not the content.
  process.env.KUNAI_REDUCED_MOTION = "1";
  setTTY(true);
  sprite.reset();
  spriteWrites = [];
  sprite.runtime.write = (text) => spriteWrites.push(text);
  sprite.runtime.env = () => ({});
  sprite.runtime.readFile = async () => new Uint8Array([1]);
  sprite.runtime.prepare = async (_bytes, bounds) => ({
    png: new Uint8Array(),
    image: {
      width: bounds.maxWidthPx,
      height: bounds.maxHeightPx,
      rgba: new Uint8Array(bounds.maxWidthPx * bounds.maxHeightPx * 4).fill(30),
    },
  });
  stdoutWrites = [];
  const spy = spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    stdoutWrites.push(String(chunk));
    return true;
  });
  restoreStdout = () => spy.mockRestore();
});

afterEach(() => {
  restoreStdout();
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  setTTY(savedIsTTY);
  Object.assign(sprite.runtime, savedRuntime);
  sprite.reset();
});

/** Every graphics escape that left the process, by any route. */
function graphicsEscapes(frames: readonly string[]): string[] {
  return [...spriteWrites, ...stdoutWrites, ...frames].filter(
    (text) => text.includes("\x1b_G") || text.includes("\x1bP") || text.includes("\x1b]1337"),
  );
}

describe("off and plain emit nothing", () => {
  for (const [name, env] of [
    ["KUNAI_PET=off", { KUNAI_PET: "off" }],
    ["plain mode", { KUNAI_PLAIN: "1" }],
  ] as const) {
    test(`${name}: no line, no glyph, no graphics escape`, () => {
      Object.assign(process.env, env, { KITTY_WINDOW_ID: "1", TERM: "xterm-kitty" });
      const view = render(<CompanionHost moment="seeking" rows={3} marginTop={1} />);
      expect(stripAnsi(view.lastFrame()).trim()).toBe("");
      view.unmount();
      expect(graphicsEscapes(view.frames)).toEqual([]);
    });
  }

  test("redirected output is off too", () => {
    setTTY(false);
    process.env.KITTY_WINDOW_ID = "1";
    const view = render(<CompanionHost moment="stuck" />);
    expect(stripAnsi(view.lastFrame()).trim()).toBe("");
    view.unmount();
    expect(graphicsEscapes(view.frames)).toEqual([]);
  });
});

describe("the glyph tier carries the character", () => {
  test("a wait is 🦊 and her line", () => {
    process.env.KUNAI_PET = "glyph";
    const view = render(<CompanionHost moment="seeking" pick={0} rows={3} />);
    expect(stripAnsi(view.lastFrame()).trim()).toBe(`🦊 ${kannaLinesFor("resolving")[0]}`);
    view.unmount();
    expect(graphicsEscapes(view.frames)).toEqual([]);
  });

  test("NO_COLOR drops the picture but keeps her", () => {
    Object.assign(process.env, { NO_COLOR: "1", KITTY_WINDOW_ID: "1", TERM: "xterm-kitty" });
    const view = render(<CompanionHost moment="stuck" pick={1} />);
    expect(stripAnsi(view.lastFrame()).trim()).toBe(`🦊 ${kannaLinesFor("error")[1]}`);
    view.unmount();
    expect(graphicsEscapes(view.frames)).toEqual([]);
  });

  test("a moment with no line is nothing at all, not a stray emoji", () => {
    process.env.KUNAI_PET = "glyph";
    for (const moment of ["watching", "empty", "missing", "settled"] as const) {
      const view = render(<CompanionHost moment={moment} />);
      expect(stripAnsi(view.lastFrame()).trim(), moment).toBe("");
      view.unmount();
    }
  });
});

describe("the graphics tier on kitty", () => {
  test("she is placeholder cells beside her line, and is deleted on unmount", async () => {
    Object.assign(process.env, { KITTY_WINDOW_ID: "1", TERM: "xterm-kitty" });
    const view = render(<CompanionHost moment="seeking" pick={0} rows={3} />);
    await act(async () => {
      await acquireKannaSprite("seek", kannaSlot(3), false);
    });
    const frame = view.lastFrame();
    expect(frame).toContain("\u{10EEEE}");
    expect(stripAnsi(frame)).toContain(kannaLinesFor("resolving")[0] as string);
    // Her picture stands in for the glyph; both would be her twice.
    expect(frame).not.toContain("🦊");
    const upload = spriteWrites.join("");
    expect(upload).toContain("a=t,");
    expect(upload).toContain("a=p,U=1,");
    // Reduced motion: one drawing, no frames, no loop.
    expect(upload).not.toContain("a=f");
    expect(upload).not.toContain("a=a");

    const [id] = sprite.liveIds();
    view.unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(spriteWrites.at(-1)).toBe(`\x1b_Ga=d,d=I,i=${id},q=2;\x1b\\`);
    expect(sprite.liveIds()).toEqual([]);
  });

  test("a poster on screen keeps the line and stands the picture down", () => {
    Object.assign(process.env, { KITTY_WINDOW_ID: "1", TERM: "xterm-kitty" });
    const view = render(<CompanionHost moment="seeking" picture={false} pick={0} />);
    expect(stripAnsi(view.lastFrame()).trim()).toBe(`🦊 ${kannaLinesFor("resolving")[0]}`);
    view.unmount();
    expect(graphicsEscapes(view.frames)).toEqual([]);
  });
});
