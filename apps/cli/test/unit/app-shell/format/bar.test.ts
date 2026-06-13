import { describe, expect, test } from "bun:test";

import { barFill, compactProgressBar } from "@/app-shell/format/bar";

describe("compactProgressBar", () => {
  test("fills proportional cells with the meter glyphs", () => {
    expect(compactProgressBar(0, 5)).toBe("▱▱▱▱▱");
    expect(compactProgressBar(100, 5)).toBe("▰▰▰▰▰");
    expect(compactProgressBar(40, 5)).toBe("▰▰▱▱▱");
  });
  test("any started title shows at least one filled cell", () => {
    expect(compactProgressBar(8, 5)).toBe("▰▱▱▱▱");
    expect(compactProgressBar(1, 5)).toBe("▰▱▱▱▱");
  });
  test("clamps out-of-range and non-finite input", () => {
    expect(compactProgressBar(150, 4)).toBe("▰▰▰▰");
    expect(compactProgressBar(-10, 4)).toBe("▱▱▱▱");
    expect(compactProgressBar(Number.NaN, 4)).toBe("▱▱▱▱");
  });
});

describe("barFill", () => {
  test("splits a row into filled + track of fixed total width", () => {
    const r = barFill(5, 10, 10);
    expect(r.filled + r.track).toBe(10);
    expect(r.filled).toBe(5);
  });
  test("full value fills the whole width", () => {
    expect(barFill(10, 10, 8)).toEqual({ filled: 8, track: 0 });
  });
  test("zero or zero-max yields an empty bar", () => {
    expect(barFill(0, 10, 8)).toEqual({ filled: 0, track: 8 });
    expect(barFill(4, 0, 8)).toEqual({ filled: 0, track: 8 });
  });
});
