import { describe, expect, test } from "bun:test";

import { getShellViewportPolicy } from "@/app-shell/layout-policy";

describe("getShellViewportPolicy", () => {
  test("marks picker viewports below minimum size as too small", () => {
    const policy = getShellViewportPolicy("picker", 80, 22);

    expect(policy.tooSmall).toBe(true);
    expect(policy.minColumns).toBe(84);
    expect(policy.minRows).toBe(24);
  });

  test("enables wide browse layout only on sufficiently large terminals", () => {
    expect(getShellViewportPolicy("browse", 164, 30).wideBrowse).toBe(true);
    expect(getShellViewportPolicy("browse", 163, 30).wideBrowse).toBe(false);
  });

  test("keeps playback policy separate from browse wide layout rules", () => {
    const policy = getShellViewportPolicy("playback", 160, 30);

    expect(policy.wideBrowse).toBe(false);
    expect(policy.tooSmall).toBe(false);
  });
});
