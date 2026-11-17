import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  alignedStatusMark,
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
    expect(plainDecorationsActive({ TERM: "dumb" }, { isTTY: true })).toBe(true);
    expect(plainDecorationsActive({ TERM: "dumb" }, { isTTY: false })).toBe(false);
  });

  test("ASCII glyphs in plain mode", () => {
    setPlainDecorationSource(() => true);
    const g = decorationGlyphs();
    expect(g.listCursor).toBe(">");
    expect(stateBlockGlyph("success")).toBe("ok");
    expect(reducedMotionEnabled({})).toBe(true);
  });

  test("plain status marks share a column width", () => {
    setPlainDecorationSource(() => true);
    const g = decorationGlyphs();
    const success = alignedStatusMark(g.statusSuccess);
    const warn = alignedStatusMark(g.warnTriangle);
    const error = alignedStatusMark(g.statusError);
    expect(success.length).toBe(warn.length);
    expect(success.length).toBe(error.length);
    expect(success.startsWith("ok")).toBe(true);
    expect(warn.startsWith("!")).toBe(true);
  });

  test("rich status marks stay one cell", () => {
    const g = decorationGlyphs();
    expect(alignedStatusMark(g.statusSuccess)).toBe("✓");
    expect(alignedStatusMark(g.warnTriangle)).toBe("△");
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
