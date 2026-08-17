import { describe, expect, test } from "bun:test";

import { segmentGeometry, windowedSegmentGeometry } from "@/app-shell/format/segmented";

/** The real Settings sections, which is where the strip first overflowed. */
const SETTINGS_SECTIONS = [
  "General",
  "Discover",
  "Provider",
  "Providers",
  "YouTube",
  "Language",
  "Playback",
  "Offline",
  "Presence",
  "Sync",
  "Update",
  "Danger Zone",
] as const;

function renderedWidth(window: ReturnType<typeof windowedSegmentGeometry>): number {
  const tabs = window.segments.reduce(
    (sum, seg, index) => sum + seg.text.length + (index > 0 ? 2 : 0),
    0,
  );
  return tabs + (window.hiddenBefore > 0 ? 2 : 0) + (window.hiddenAfter > 0 ? 2 : 0);
}

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

describe("windowedSegmentGeometry", () => {
  test("keeps every segment when the strip already fits", () => {
    const w = windowedSegmentGeometry(["All", "Series", "Anime"], 1, 80);
    expect(w.segments).toHaveLength(3);
    expect(w.hiddenBefore).toBe(0);
    expect(w.hiddenAfter).toBe(0);
  });

  test("fits the twelve Settings sections into 80 columns", () => {
    // The whole point: twelve labels do not fit, and squeezing them produced
    // two-character stumps that wrapped into an unreadable second line.
    for (let active = 0; active < SETTINGS_SECTIONS.length; active++) {
      const w = windowedSegmentGeometry(SETTINGS_SECTIONS, active, 60);
      expect(renderedWidth(w)).toBeLessThanOrEqual(60);
      expect(w.segments.length).toBeGreaterThan(0);
    }
  });

  test("always shows the active section in full", () => {
    for (let active = 0; active < SETTINGS_SECTIONS.length; active++) {
      const w = windowedSegmentGeometry(SETTINGS_SECTIONS, active, 60);
      const activeSeg = w.segments.find((seg) => seg.active);
      expect(activeSeg?.label).toBe(SETTINGS_SECTIONS[active]);
      expect(activeSeg?.text).toBe(` ${SETTINGS_SECTIONS[active]} `);
    }
  });

  test("reports what is hidden so the caller can render scroll affordances", () => {
    const last = SETTINGS_SECTIONS.length - 1;
    const atEnd = windowedSegmentGeometry(SETTINGS_SECTIONS, last, 40);
    expect(atEnd.hiddenBefore).toBeGreaterThan(0);
    expect(atEnd.hiddenAfter).toBe(0);

    const atStart = windowedSegmentGeometry(SETTINGS_SECTIONS, 0, 40);
    expect(atStart.hiddenBefore).toBe(0);
    expect(atStart.hiddenAfter).toBeGreaterThan(0);
  });

  test("keeps the active section rather than rendering nothing when it alone overflows", () => {
    const w = windowedSegmentGeometry(SETTINGS_SECTIONS, 11, 4);
    expect(w.segments).toHaveLength(1);
    expect(w.segments[0]?.label).toBe("Danger Zone");
  });

  test("treats a missing or nonsensical width as unconstrained", () => {
    for (const width of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const w = windowedSegmentGeometry(SETTINGS_SECTIONS, 3, width);
      expect(w.segments).toHaveLength(SETTINGS_SECTIONS.length);
    }
  });

  test("empty input yields an empty window", () => {
    const w = windowedSegmentGeometry([], 0, 80);
    expect(w.segments).toEqual([]);
    expect(w.hiddenBefore).toBe(0);
    expect(w.hiddenAfter).toBe(0);
  });
});
