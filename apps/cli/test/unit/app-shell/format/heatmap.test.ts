import { describe, expect, test } from "bun:test";

import { boundHeatWindow, heatBucket } from "@/app-shell/format/heatmap";

describe("heatBucket", () => {
  test("zero value is bucket 0", () => {
    expect(heatBucket(0, 10)).toBe(0);
  });
  test("max value is bucket 4", () => {
    expect(heatBucket(10, 10)).toBe(4);
  });
  test("scales into 1..4 for non-zero values", () => {
    expect(heatBucket(3, 10)).toBe(2);
  });
  test("guards a zero max", () => {
    expect(heatBucket(5, 0)).toBe(0);
  });
});

describe("boundHeatWindow", () => {
  test("keeps only the most recent N entries", () => {
    const entries = Array.from({ length: 18 }, (_, i) => ({ month: i }));
    expect(boundHeatWindow(entries, 12)).toHaveLength(12);
    expect(boundHeatWindow(entries, 12)[0]?.month).toBe(6);
  });
  test("returns all entries when fewer than the window", () => {
    const entries = [{ month: 1 }, { month: 2 }];
    expect(boundHeatWindow(entries, 12)).toHaveLength(2);
  });
});
