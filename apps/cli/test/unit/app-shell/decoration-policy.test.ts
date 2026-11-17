import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  decorationGlyphs,
  EMOJI_OR_MASCOT,
  plainDecorationsActive,
  setPlainDecorationSource,
  stateBlockGlyph,
} from "@/app-shell/decoration-policy";
import { reducedMotionEnabled } from "@/app-shell/motion-policy";

beforeEach(() => {
  setPlainDecorationSource(() => false);
});

afterEach(() => {
  setPlainDecorationSource(() => false);
});

describe("decoration-policy", () => {
  test("plain mode follows minimalMode source and TERM=dumb", () => {
    expect(plainDecorationsActive({ TERM: "xterm-256color" })).toBe(false);
    setPlainDecorationSource(() => true);
    expect(plainDecorationsActive({ TERM: "xterm-256color" })).toBe(true);
    setPlainDecorationSource(() => false);
    expect(plainDecorationsActive({ TERM: "dumb" })).toBe(true);
  });

  test("ASCII glyphs in plain mode", () => {
    setPlainDecorationSource(() => true);
    const g = decorationGlyphs();
    expect(g.listCursor).toBe(">");
    expect(stateBlockGlyph("success")).toBe("ok");
    expect(reducedMotionEnabled({})).toBe(true);
  });

  test("rich glyphs by default", () => {
    const env = { TERM: "xterm-256color" };
    const g = decorationGlyphs(env);
    expect(g.listCursor).toBe("▌");
    expect(stateBlockGlyph("success", env)).toBe("✓");
  });

  test("emoji detector matches pictographics", () => {
    expect(EMOJI_OR_MASCOT.test("🦊 nothing here yet.")).toBe(true);
    expect(EMOJI_OR_MASCOT.test("no mascot here")).toBe(false);
  });
});
