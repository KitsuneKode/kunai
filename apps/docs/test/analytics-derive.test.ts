import { describe, expect, test } from "bun:test";

import {
  availableRanges,
  dayToEpoch,
  delta,
  formatDayTick,
  namedVersionCount,
  residualShare,
  sliceRange,
} from "../lib/analytics-derive";
import type { SeriesPoint } from "../lib/analytics-series";

function day(index: number, activeInstalls = 1): SeriesPoint {
  const date = new Date(Date.UTC(2026, 0, 1 + index));
  return {
    day: date.toISOString().slice(0, 10),
    activeInstalls,
    lifetimeInstalls: index + 1,
    byVersion: { other: activeInstalls },
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
