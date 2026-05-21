import { describe, expect, test } from "bun:test";

import { segmentGeometry } from "@/app-shell/format/segmented";

describe("segmentGeometry", () => {
  test("marks the active segment and pads its label as a pill", () => {
    const g = segmentGeometry(["All", "Series", "Anime"], 0);
    expect(g.map((s) => s.active)).toEqual([true, false, false]);
    expect(g[0]?.text).toBe(" All ");
    expect(g[1]?.text).toBe("Series");
  });
  test("clamps the active index", () => {
    const g = segmentGeometry(["A", "B"], 9);
    expect(g[1]?.active).toBe(true);
  });
  test("empty input yields empty geometry", () => {
    expect(segmentGeometry([], 0)).toEqual([]);
  });
});
