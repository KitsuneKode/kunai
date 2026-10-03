import { describe, expect, test } from "bun:test";

import {
  availableRanges,
  dayToEpoch,
  delta,
  formatDayTick,
  namedBucketCount,
  namedVersionCount,
  platformColumns,
  platformLabel,
  releaseMarkers,
  residualShare,
  rollingMean,
  sliceRange,
} from "../lib/analytics-derive";
import type { SeriesPoint } from "../lib/analytics-series";

function day(
  index: number,
  activeInstalls = 1,
  byOs: Record<string, number> = { other: activeInstalls },
): SeriesPoint {
  const date = new Date(Date.UTC(2026, 0, 1 + index));
  return {
    day: date.toISOString().slice(0, 10),
    activeInstalls,
    newInstalls: null,
    lifetimeInstalls: index + 1,
    byVersion: { other: activeInstalls },
    byOs,
    byArch: { other: activeInstalls },
  };
}

const window = (length: number): SeriesPoint[] => Array.from({ length }, (_, i) => day(i));

describe("delta", () => {
  test("signs the label and names the direction", () => {
    expect(delta(5, 3)).toEqual({ value: 2, direction: "up", label: "+2" });
    expect(delta(3, 5)).toEqual({ value: -2, direction: "down", label: "-2" });
  });

  test("flat is a real answer, not a missing one", () => {
    expect(delta(4, 4)).toEqual({ value: 0, direction: "flat", label: "0" });
  });
});

describe("availableRanges", () => {
  test("offers nothing when no range would cut the window", () => {
    // 7 days: "Last 7 days" and "All" would draw the identical chart.
    expect(availableRanges(window(7))).toEqual([]);
    expect(availableRanges(window(1))).toEqual([]);
  });

  test("offers 7d plus all once the window is longer than a week", () => {
    const options = availableRanges(window(9)).map((o) => o.key);
    expect(options).toEqual(["7d", "all"]);
  });

  test("adds 30d only past thirty days, and labels all with the real span", () => {
    const options = availableRanges(window(31));
    expect(options.map((o) => o.key)).toEqual(["7d", "30d", "all"]);
    expect(options.at(-1)?.label).toBe("All 31 days");
  });
});

describe("sliceRange", () => {
  test("all is the identity slice", () => {
    const points = window(9);
    expect(sliceRange(points, "all")).toBe(points);
  });

  test("takes the tail, not the head", () => {
    const sliced = sliceRange(window(9), "7d");
    expect(sliced).toHaveLength(7);
    expect(sliced[0]?.day).toBe("2026-01-03");
    expect(sliced.at(-1)?.day).toBe("2026-01-09");
  });

  test("never pads a window shorter than the range", () => {
    expect(sliceRange(window(3), "30d")).toHaveLength(3);
  });
});

describe("residualShare", () => {
  test("reports full suppression as 1", () => {
    expect(residualShare({ other: 2 })).toBe(1);
  });

  test("reports a mixed breakdown as the residual fraction", () => {
    expect(residualShare({ "0.3.0": 6, other: 2 })).toBe(0.25);
  });

  test("an empty breakdown suppressed nothing", () => {
    // Nothing was collected, so claiming 100% suppression would be a lie.
    expect(residualShare({})).toBe(0);
  });
});

describe("namedVersionCount", () => {
  test("ignores the residual bucket and zero counts", () => {
    const points: SeriesPoint[] = [
      { ...day(0), byVersion: { "0.3.0": 4, other: 2 } },
      { ...day(1), byVersion: { "0.3.0": 3, "0.2.9": 0, other: 5 } },
    ];
    expect(namedVersionCount(points)).toBe(1);
  });

  test("counts each version once across the window", () => {
    const points: SeriesPoint[] = [
      { ...day(0), byVersion: { "0.3.0": 4 } },
      { ...day(1), byVersion: { "0.3.0": 3, "0.3.1": 2 } },
    ];
    expect(namedVersionCount(points)).toBe(2);
  });
});

describe("dayToEpoch", () => {
  test("parses the rollup key as UTC midnight", () => {
    expect(dayToEpoch("2026-08-18")).toBe(Date.UTC(2026, 7, 18));
  });

  test("spacing follows the calendar, not the array index", () => {
    // The guarantee the x-axis depends on: readRollups omits days the cron
    // missed, so a gap must be drawn proportional to real elapsed time. A
    // category axis would place these three points at equal spacing and make
    // an eleven-day hole look like a one-day step.
    const [first, second, third] = ["2026-08-01", "2026-08-02", "2026-08-13"].map(dayToEpoch) as [
      number,
      number,
      number,
    ];
    const oneDay = 86_400_000;
    expect(second - first).toBe(oneDay);
    expect(third - second).toBe(11 * oneDay);
  });

  test("an unparseable day is NaN rather than a silent zero", () => {
    // Zero would place the point at the epoch, dragging the whole domain to 1970.
    expect(Number.isNaN(dayToEpoch("not-a-date"))).toBe(true);
  });
});

describe("formatDayTick", () => {
  test("labels in UTC, not the runner's timezone", () => {
    // A local-midnight parse would render this as Aug 17 anywhere west of UTC.
    expect(formatDayTick(dayToEpoch("2026-08-18"))).toBe("Aug 18");
  });

  test("an unparseable tick renders empty rather than 'Invalid Date'", () => {
    expect(formatDayTick(Number.NaN)).toBe("");
  });
});

describe("platformLabel", () => {
  test("decodes the closed OS keyspace into names a reader recognises", () => {
    expect(platformLabel("linux")).toBe("Linux");
    expect(platformLabel("darwin")).toBe("macOS");
    expect(platformLabel("win32")).toBe("Windows");
    expect(platformLabel("other")).toBe("Other");
  });

  test("passes anything else through — safe on version and arch buckets", () => {
    expect(platformLabel("0.3.0")).toBe("0.3.0");
    expect(platformLabel("x64")).toBe("x64");
    expect(platformLabel("freebsd")).toBe("freebsd");
  });
});

describe("platformColumns", () => {
  test("orders the canonical platforms first and the residual last", () => {
    const points = [
      day(0, 12, { win32: 5, other: 4, darwin: 3 }),
      day(1, 20, { darwin: 8, linux: 12 }),
    ];
    expect(platformColumns(points)).toEqual(["linux", "darwin", "win32", "other"]);
  });

  test("a bucket absent from the whole window earns no column", () => {
    expect(platformColumns([day(0, 6, { linux: 6 })])).toEqual(["linux"]);
  });

  test("no OS data at all yields no columns", () => {
    expect(platformColumns([day(0, 3, {})])).toEqual([]);
  });

  test("an unexpected bucket sorts between the named platforms and the residual", () => {
    const points = [day(0, 9, { linux: 4, freebsd: 2, other: 3 })];
    expect(platformColumns(points)).toEqual(["linux", "freebsd", "other"]);
  });
});

describe("namedBucketCount", () => {
  test("counts only real, non-empty buckets from one breakdown", () => {
    expect(namedBucketCount({ "0.3.0": 5, other: 9, "0.2.0": 0 })).toBe(1);
  });

  test("a breakdown that is all residual names nothing", () => {
    expect(namedBucketCount({ other: 3 })).toBe(0);
    expect(namedBucketCount({})).toBe(0);
  });

  test("agrees with residualShare: a tile cannot say 0% suppressed and name nothing", () => {
    const counts = { "0.3.0": 5 };
    expect(residualShare(counts)).toBe(0);
    expect(namedBucketCount(counts)).toBeGreaterThan(0);
  });
});

describe("rollingMean", () => {
  test("shortens at the start instead of padding with zeros", () => {
    expect(rollingMean([4, 6, 8], 3)).toEqual([4, 5, 6]);
  });

  test("slides once the window is full", () => {
    expect(rollingMean([1, 2, 3, 4], 2)).toEqual([1, 1.5, 2.5, 3.5]);
  });

  test("skips nulls and keeps a gap where a window has no real value", () => {
    expect(rollingMean([null, null, 6], 2)).toEqual([null, null, 6]);
    expect(rollingMean([2, null, 4], 2)).toEqual([2, 2, 4]);
  });
});

describe("releaseMarkers", () => {
  const points = [day(0), day(1), day(2), day(3)];

  test("keeps only releases inside the plotted window, oldest first", () => {
    const markers = releaseMarkers(points, [
      { date: "2026-01-03", tag: "v2" },
      { date: "2025-12-30", tag: "v0" },
      { date: "2026-01-02", tag: "v1" },
      { date: "2026-02-01", tag: "v9" },
    ]);
    expect(markers.map((m) => m.tag)).toEqual(["v1", "v2"]);
  });

  test("includes both edges of the window", () => {
    const markers = releaseMarkers(points, [
      { date: "2026-01-01", tag: "first" },
      { date: "2026-01-04", tag: "last" },
    ]);
    expect(markers).toHaveLength(2);
  });

  test("reads the day from a timestamp and ignores unparseable dates", () => {
    const markers = releaseMarkers(points, [
      { date: "2026-01-02T10:00:00Z", tag: "iso" },
      { date: null, tag: "undated" },
      { date: "soon", tag: "bad" },
    ]);
    expect(markers).toEqual([{ day: "2026-01-02", tag: "iso" }]);
  });

  test("an empty window has no markers", () => {
    expect(releaseMarkers([], [{ date: "2026-01-02", tag: "v1" }])).toEqual([]);
  });
});
