import { describe, expect, test } from "bun:test";

import { barFill } from "@/app-shell/format/bar";

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
