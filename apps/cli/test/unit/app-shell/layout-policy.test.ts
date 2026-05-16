import { describe, expect, test } from "bun:test";

import { getPickerLayout, getShellViewportPolicy } from "@/app-shell/layout-policy";

describe("getShellViewportPolicy", () => {
  test("marks picker viewports below minimum size as too small", () => {
    const policy = getShellViewportPolicy("picker", 79, 19);

    expect(policy.columns).toBe(79);
    expect(policy.rows).toBe(19);
    expect(policy.tooSmall).toBe(true);
    expect(policy.minColumns).toBe(80);
    expect(policy.minRows).toBe(24);
  });

  test("marks browse viewports below minimum size as too small", () => {
    const policy = getShellViewportPolicy("browse", 79, 19);

    expect(policy.columns).toBe(79);
    expect(policy.rows).toBe(19);
    expect(policy.tooSmall).toBe(true);
    expect(policy.minColumns).toBe(80);
    expect(policy.minRows).toBe(20);
  });

  test("marks playback viewports below minimum size as too small", () => {
    const policy = getShellViewportPolicy("playback", 91, 21);

    expect(policy.columns).toBe(91);
    expect(policy.rows).toBe(21);
    expect(policy.tooSmall).toBe(true);
    expect(policy.minColumns).toBe(92);
    expect(policy.minRows).toBe(22);
  });

  test("enables wide browse layout only on sufficiently large terminals", () => {
    expect(getShellViewportPolicy("browse", 164, 30).wideBrowse).toBe(true);
    expect(getShellViewportPolicy("browse", 163, 30).wideBrowse).toBe(false);
  });

  test("enables medium browse layout between 132 and 163 columns", () => {
    expect(getShellViewportPolicy("browse", 132, 30).mediumBrowse).toBe(true);
    expect(getShellViewportPolicy("browse", 131, 30).mediumBrowse).toBe(false);
    expect(getShellViewportPolicy("browse", 164, 30).mediumBrowse).toBe(false);
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
});
