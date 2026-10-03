import { describe, expect, test } from "bun:test";

import { nextNavHover, nextNavPin, shouldCompactNav } from "../lib/nav-compact";

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

describe("nextNavHover", () => {
  const onPill = { insidePill: true, onSteadyControl: false };
  const onSteady = { insidePill: true, onSteadyControl: true };

  test("opens when the pointer rests on the pill away from the controls it aims at", () => {
    expect(nextNavHover(false, onPill)).toBe(true);
  });

  test("does not open for the brand or the search icon: they must not slide away from the cursor", () => {
    expect(nextNavHover(false, onSteady)).toBe(false);
  });

  test("stays open while the pointer travels over the brand or search once it is open", () => {
    expect(nextNavHover(true, onSteady)).toBe(true);
    expect(nextNavHover(true, onPill)).toBe(true);
  });

  test("closes the moment the pointer leaves the pill, open or not", () => {
    expect(nextNavHover(true, { insidePill: false, onSteadyControl: false })).toBe(false);
    expect(nextNavHover(false, { insidePill: false, onSteadyControl: false })).toBe(false);
  });
});

describe("nextNavPin", () => {
  test("a press on the expander toggles", () => {
    expect(nextNavPin(false, "toggle")).toBe(true);
    expect(nextNavPin(true, "toggle")).toBe(false);
  });

  test("an outside press, Escape and scrolling back to the top all close it", () => {
    for (const event of ["outside", "escape", "uncompact"] as const) {
      expect(nextNavPin(true, event)).toBe(false);
      expect(nextNavPin(false, event)).toBe(false);
    }
  });
});
