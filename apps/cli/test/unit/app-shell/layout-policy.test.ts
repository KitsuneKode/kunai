import { describe, expect, test } from "bun:test";

import {
  getBrowseCommandPaletteMaxVisible,
  getCommandPaletteVisibleCommandCount,
  getPickerLayout,
  getShellViewportPolicy,
} from "@/app-shell/layout-policy";
import { getShellTerminalProfile } from "@/app-shell/use-viewport-policy";

describe("getShellViewportPolicy", () => {
  test("marks picker viewports below minimum size as too small", () => {
    const policy = getShellViewportPolicy("picker", 59, 19);

    expect(policy.columns).toBe(59);
    expect(policy.rows).toBe(19);
    expect(policy.tooSmall).toBe(true);
    expect(policy.minColumns).toBe(60);
    expect(policy.minRows).toBe(20);
  });

  test("marks browse viewports below minimum size as too small", () => {
    const policy = getShellViewportPolicy("browse", 59, 19);

    expect(policy.columns).toBe(59);
    expect(policy.rows).toBe(19);
    expect(policy.tooSmall).toBe(true);
    expect(policy.minColumns).toBe(60);
    expect(policy.minRows).toBe(20);
  });

  test("marks playback viewports below minimum size as too small", () => {
    const policy = getShellViewportPolicy("playback", 59, 19);

    expect(policy.columns).toBe(59);
    expect(policy.rows).toBe(19);
    expect(policy.tooSmall).toBe(true);
    expect(policy.minColumns).toBe(60);
    expect(policy.minRows).toBe(20);
  });

  test("enables wide browse layout only on sufficiently large terminals", () => {
    expect(getShellViewportPolicy("browse", 120, 30).wideBrowse).toBe(true);
    expect(getShellViewportPolicy("browse", 119, 30).wideBrowse).toBe(false);
  });

  test("medium browse breakpoint: 80–119 cols (mediumBrowse retired; use breakpoint field)", () => {
    expect(getShellViewportPolicy("browse", 80, 30).breakpoint).toBe("medium");
    expect(getShellViewportPolicy("browse", 79, 30).breakpoint).toBe("narrow");
    expect(getShellViewportPolicy("browse", 120, 30).breakpoint).toBe("wide");
    // mediumBrowse legacy flag is true at medium width for browse kind; callers should use breakpoint === "medium"
    expect(getShellViewportPolicy("browse", 80, 30).mediumBrowse).toBe(true);
  });

  test("keeps playback policy separate from browse wide layout rules", () => {
    const policy = getShellViewportPolicy("playback", 160, 30);

    expect(policy.wideBrowse).toBe(false);
    expect(policy.tooSmall).toBe(false);
  });

  test("getPickerLayout computes consistent dimensions", () => {
    const layout = getPickerLayout(120, 30);
    expect(layout.innerWidth).toBe(112);
    expect(layout.showCompanion).toBe(true);
    expect(layout.companionWidth).toBeGreaterThanOrEqual(30);
    expect(layout.listWidth).toBeGreaterThanOrEqual(36);
    expect(layout.rowWidth).toBeGreaterThanOrEqual(20);
  });

  test("getPickerLayout hides companion on narrow terminals", () => {
    const layout = getPickerLayout(100, 20);
    expect(layout.showCompanion).toBe(false);
    expect(layout.companionWidth).toBe(0);
    expect(layout.listWidth).toBe(layout.innerWidth);
  });

  test("browse command palette budget stays bounded on common terminal heights", () => {
    expect(getBrowseCommandPaletteMaxVisible(24, false, false)).toBeGreaterThanOrEqual(1);
    expect(getBrowseCommandPaletteMaxVisible(30, false, false)).toBeLessThanOrEqual(8);
    expect(getBrowseCommandPaletteMaxVisible(30, true, true)).toBeLessThanOrEqual(5);
    expect(getBrowseCommandPaletteMaxVisible(48, false, false)).toBe(18);
    expect(getBrowseCommandPaletteMaxVisible(48, false, false)).toBeGreaterThanOrEqual(12);
  });

  test("command palette visible command count leaves room for group and more rows", () => {
    expect(
      getCommandPaletteVisibleCommandCount({
        maxRows: 5,
        totalMatches: 25,
        grouped: true,
      }),
    ).toBe(1);
    expect(
      getCommandPaletteVisibleCommandCount({
        maxRows: 8,
        totalMatches: 25,
        grouped: false,
      }),
    ).toBe(6);
  });

  test("narrow breakpoint: 60–79 cols, rows >= 20", () => {
    const p = getShellViewportPolicy("browse", 60, 24);
    expect(p.breakpoint).toBe("narrow");
    expect(p.tooSmall).toBe(false);
  });

  test("medium breakpoint: 80–119 cols", () => {
    const p = getShellViewportPolicy("browse", 80, 24);
    expect(p.breakpoint).toBe("medium");
    expect(p.wideBrowse).toBe(false);
    expect(p.mediumBrowse).toBe(true);
  });

  test("wide breakpoint: 120+ cols", () => {
    const p = getShellViewportPolicy("browse", 120, 24);
    expect(p.breakpoint).toBe("wide");
    expect(p.wideBrowse).toBe(true);
  });

  test("preview rail appears after the wide breakpoint so the list keeps priority", () => {
    expect(getShellViewportPolicy("browse", 128, 30).wideBrowse).toBe(true);
    expect(getShellViewportPolicy("browse", 128, 30).previewRail).toBe(false);
    expect(getShellViewportPolicy("browse", 144, 30).previewRail).toBe(true);
  });

  test("preview rail stays collapsed in constrained SSH or tmux terminals", () => {
    expect(
      getShellViewportPolicy("browse", 160, 30, { terminalProfile: "constrained" }).previewRail,
    ).toBe(false);
    expect(getShellTerminalProfile({ SSH_TTY: "/dev/pts/4", TERM: "xterm-256color" })).toBe(
      "constrained",
    );
    expect(getShellTerminalProfile({ TMUX: "/tmp/tmux-1000/default,1,0" })).toBe("constrained");
  });

  test("blocked: < 60 cols", () => {
    const p = getShellViewportPolicy("browse", 59, 24);
    expect(p.breakpoint).toBe("blocked");
    expect(p.tooSmall).toBe(true);
  });

  test("blocked: < 20 rows", () => {
    const p = getShellViewportPolicy("browse", 80, 19);
    expect(p.breakpoint).toBe("blocked");
    expect(p.tooSmall).toBe(true);
  });
});
