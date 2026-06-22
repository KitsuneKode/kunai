import { describe, expect, test } from "bun:test";

import {
  getBrowseChromeRows,
  getBrowseListMaxVisible,
  getBrowseCommandPaletteMaxVisible,
  getCommandPaletteVisibleCommandCount,
  getFooterReservedRows,
  getOverlayContentViewport,
  getOverlayHostChromeRows,
  getOverlayListMaxVisible,
  getPickerChromeRows,
  getPickerListMaxVisible,
  getPickerLayout,
  ROOT_CHROME_ROWS,
  TRANSIENT_ROW_SLOTS,
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

  test("zen collapses to a single column at any width (no companion, no rail)", () => {
    const wide = getShellViewportPolicy("browse", 160, 40, { zen: true });
    expect(wide.zen).toBe(true);
    expect(wide.wideBrowse).toBe(false);
    expect(wide.mediumBrowse).toBe(false);
    expect(wide.previewRail).toBe(false);
    expect(wide.breakpoint).toBe("narrow");
    // Still usable: not flagged too-small purely because of zen.
    expect(wide.tooSmall).toBe(false);
  });

  test("zen defaults to off and does not change normal wide layout", () => {
    const normal = getShellViewportPolicy("browse", 160, 40);
    expect(normal.zen).toBe(false);
    expect(normal.wideBrowse).toBe(true);
  });

  test("zen never overrides the blocked breakpoint on a too-small terminal", () => {
    const blocked = getShellViewportPolicy("browse", 59, 19, { zen: true });
    expect(blocked.breakpoint).toBe("blocked");
    expect(blocked.tooSmall).toBe(true);
  });

  test("browse chrome row budget keeps list visible on short terminals", () => {
    const chromeRows = getBrowseChromeRows({
      hasResultSubtitle: true,
      hasFilterBar: false,
      hasFilterBadges: false,
      hasCalendarChrome: false,
      hasContextStrip: false,
      hasQueryDirtyHint: false,
      commandMode: false,
    });
    expect(getBrowseListMaxVisible(24, chromeRows)).toBeGreaterThanOrEqual(1);
    expect(getBrowseListMaxVisible(24, chromeRows)).toBeLessThanOrEqual(8);
  });

  test("browse list budget reserves scroll affordance rows on tight terminals", () => {
    const chromeRows = getBrowseChromeRows({
      hasResultSubtitle: true,
      hasFilterBar: true,
      hasFilterBadges: true,
      hasCalendarChrome: true,
      hasContextStrip: true,
      hasQueryDirtyHint: false,
      commandMode: false,
    });
    const rows = 34;
    const visibleRows = getBrowseListMaxVisible(rows, chromeRows);

    expect(visibleRows).toBe(1);
    expect(visibleRows + 2).toBeLessThanOrEqual(
      rows - ROOT_CHROME_ROWS - TRANSIENT_ROW_SLOTS - chromeRows - 5 - 3,
    );
  });

  test("browse list max visible stays stable when transient content toggles", () => {
    const chromeRows = getBrowseChromeRows({
      hasResultSubtitle: false,
      hasFilterBar: false,
      hasFilterBadges: false,
      hasCalendarChrome: false,
      hasContextStrip: false,
      hasQueryDirtyHint: false,
      commandMode: false,
    });
    const withTransientReserved = getBrowseListMaxVisible(30, chromeRows);
    expect(withTransientReserved).toBe(
      getBrowseListMaxVisible(30, chromeRows, ROOT_CHROME_ROWS, 1),
    );
    expect(withTransientReserved).toBeLessThan(
      getBrowseListMaxVisible(30, chromeRows, ROOT_CHROME_ROWS, 0),
    );
  });

  test("overlay content viewport subtracts root chrome, transient row, and overlay host chrome", () => {
    const hostChrome = getOverlayHostChromeRows({ commandMode: false, dedicatedShell: false });
    const viewport = getOverlayContentViewport({
      terminalRows: 40,
      terminalCols: 100,
      overlayChromeRows: hostChrome,
    });
    expect(viewport.contentColumns).toBe(92);
    expect(viewport.contentRows).toBeGreaterThanOrEqual(8);
    expect(viewport.contentRows).toBeLessThan(40);
  });

  test("overlay list max visible scales with terminal height on 24-row and 40-row terminals", () => {
    const hostChrome = getOverlayHostChromeRows({ commandMode: false, dedicatedShell: false });
    const short = getOverlayListMaxVisible({
      terminalRows: 24,
      terminalCols: 80,
      overlayChromeRows: hostChrome,
      panelKind: "picker",
    });
    const tall = getOverlayListMaxVisible({
      terminalRows: 40,
      terminalCols: 80,
      overlayChromeRows: hostChrome,
      panelKind: "picker",
    });
    expect(short).toBeGreaterThanOrEqual(1);
    expect(short).toBeLessThanOrEqual(6);
    expect(tall).toBeGreaterThan(short);
    expect(tall).toBeLessThanOrEqual(18);
  });

  test("footer reserved rows account for command palette mode", () => {
    expect(getFooterReservedRows({ mode: "detailed", commandMode: false })).toBe(3);
    expect(getFooterReservedRows({ mode: "detailed", commandMode: true })).toBeGreaterThan(3);
  });

  test("picker chrome row budget replaces ad-hoc maxVisibleRows subtraction", () => {
    const chromeRows = getPickerChromeRows({ hasSubtitle: true, commandMode: false, extraRows: 4 });
    expect(getPickerListMaxVisible(30, chromeRows)).toBeGreaterThanOrEqual(3);
    expect(getPickerListMaxVisible(30, chromeRows)).toBeLessThan(
      getPickerListMaxVisible(45, chromeRows),
    );
  });

  test("picker list budget reserves rows for more-above and more-below indicators", () => {
    const chromeRows = getPickerChromeRows({ hasSubtitle: true, commandMode: false, extraRows: 4 });
    const visibleRows = getPickerListMaxVisible(30, chromeRows);

    expect(visibleRows).toBe(3);
    expect(visibleRows + 2).toBeLessThanOrEqual(30 - ROOT_CHROME_ROWS - chromeRows - 5 - 3);
  });

  test("forceCompact blocks large terminals (legacy minimalMode bug — browse no longer passes this)", () => {
    const blocked = getShellViewportPolicy("browse", 120, 40, { forceCompact: true });
    expect(blocked.breakpoint).toBe("blocked");
    expect(blocked.tooSmall).toBe(true);

    const normal = getShellViewportPolicy("browse", 120, 40);
    expect(normal.breakpoint).toBe("wide");
    expect(normal.tooSmall).toBe(false);
  });
});
