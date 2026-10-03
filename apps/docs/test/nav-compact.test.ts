import { describe, expect, test } from "bun:test";

import { shouldCompactNav } from "../lib/nav-compact";

describe("shouldCompactNav", () => {
  test("stays full size while the sentinel is on screen", () => {
    expect(shouldCompactNav({ isIntersecting: true, top: 10 })).toBe(false);
  });

  test("shrinks once the sentinel has scrolled up out of view", () => {
    expect(shouldCompactNav({ isIntersecting: false, top: -20 })).toBe(true);
  });

  test("does not shrink for a visitor who has not scrolled: a sentinel below the fold is also not intersecting", () => {
    expect(shouldCompactNav({ isIntersecting: false, top: 900 })).toBe(false);
  });
});
