import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  alignedStatusMark,
  cursorThen,
  decorationGlyphs,
  EMOJI_OR_MASCOT,
  formatScoreLabel,
  plainDecorationFromLayout,
  plainDecorationsActive,
  scrollAffordance,
  searchFieldPrefix,
  setPlainDecorationSource,
  stateBlockGlyph,
  streakHeroPrefix,
  streakMilestoneAlert,
  undecoratedCopy,
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

  test("a saved zen layout uses the same plain chrome as minimal", () => {
    expect(plainDecorationFromLayout({ minimalMode: false, zenMode: true })).toBe(true);
    expect(plainDecorationFromLayout({ minimalMode: true, zenMode: false })).toBe(true);
    expect(plainDecorationFromLayout({ minimalMode: false, zenMode: false })).toBe(false);
  });

  test("plain copy drops stars, fire, and arrow scroll marks", () => {
    setPlainDecorationSource(() => true);
    expect(formatScoreLabel(8.1)).toBe("8.1/10");
    expect(formatScoreLabel(8.1, "spaced")).toBe("8.1/10");
    expect(streakMilestoneAlert(3)).toBe("3-day streak! Keep it going.");
    expect(streakHeroPrefix()).toBe("");
    expect(undecoratedCopy("🔥 3d streak")).toBe("3d streak");
    expect(scrollAffordance("up")).toBe(" more above");
    expect(scrollAffordance("down", "more")).toBe(" more below");
    expect(cursorThen("[ ]", true)).toBe("> [ ]");
    expect(decorationGlyphs().search).toBe("Search");
    expect(decorationGlyphs().disclosure).toBe("...");
    expect(searchFieldPrefix(true)).toBe("Search ");
    expect(searchFieldPrefix(false)).toBe("");
  });

  test("rich copy keeps the decorated forms", () => {
    expect(formatScoreLabel(8.1)).toBe("★8.1");
    expect(formatScoreLabel(8.1, "spaced")).toBe("★ 8.1");
    expect(streakMilestoneAlert(3)).toBe("🔥 3-day streak! Keep it going.");
    expect(streakHeroPrefix()).toBe("🔥 ");
    expect(scrollAffordance("down")).toBe(" ▼ ...");
    expect(scrollAffordance("up", "more")).toBe(" ▲ more");
    expect(scrollAffordance("down", "scroll")).toBe("▼ scroll");
    expect(cursorThen("○", true)).toBe("▌ ○");
    expect(searchFieldPrefix(true)).toBe("⌕ ");
    expect(searchFieldPrefix(false)).toBe("› ");
  });

  test("emoji detector matches pictographics", () => {
    expect(EMOJI_OR_MASCOT.test("🦊 nothing here yet.")).toBe(true);
    expect(EMOJI_OR_MASCOT.test("no mascot here")).toBe(false);
  });
});
