import { describe, expect, test } from "bun:test";

import {
  compareVersions,
  dayOffsets,
  isFullySuppressed,
  MAX_VERSION_BANDS,
  parseDocsAnalyticsSeries,
  versionBands,
  type DocsAnalyticsSeries,
} from "../lib/analytics-series";

function series(
  points: readonly { day: string; active?: number; byVersion?: Record<string, number> }[],
): DocsAnalyticsSeries {
  return {
    from: points[0]?.day ?? "",
    to: points.at(-1)?.day ?? "",
    updatedAt: "2026-08-26T00:05:00.000Z",
    points: points.map((p) => ({
      day: p.day,
      activeInstalls: p.active ?? 10,
      lifetimeInstalls: 50,
      byVersion: p.byVersion ?? { "0.3.0": 10 },
    })),
  };
}

describe("parseDocsAnalyticsSeries", () => {
  const valid = {
    from: "2026-08-01",
    to: "2026-08-02",
    updatedAt: "2026-08-02T00:05:00.000Z",
    points: [
      { day: "2026-08-01", activeInstalls: 10, lifetimeInstalls: 40, byVersion: { "0.3.0": 10 } },
      { day: "2026-08-02", activeInstalls: 12, lifetimeInstalls: 42, byVersion: { "0.3.0": 12 } },
    ],
  };

  test("a well-formed payload round-trips", () => {
    const parsed = parseDocsAnalyticsSeries(valid);
    expect(parsed?.points).toHaveLength(2);
    expect(parsed?.points[1]?.activeInstalls).toBe(12);
  });

  /**
   * `from`/`to` are rendered as the axis labels, so they are a claim about what
   * the chart covers. Every point inside is already rejected on a bad day; the
   * window that frames them cannot be the one value taken on trust.
   */
  test("a malformed window bound rejects the series", () => {
    expect(parseDocsAnalyticsSeries({ ...valid, from: "nope" })).toBeNull();
    expect(parseDocsAnalyticsSeries({ ...valid, to: "2026-13-45" })).toBeNull();
    expect(parseDocsAnalyticsSeries({ ...valid, from: "" })).toBeNull();
  });

  test("a window that runs backwards is refused", () => {
    expect(parseDocsAnalyticsSeries({ ...valid, from: "2026-08-02", to: "2026-08-01" })).toBeNull();
    // A single-day window is legitimate — from and to may be equal.
    expect(
      parseDocsAnalyticsSeries({
        ...valid,
        from: "2026-08-01",
        to: "2026-08-01",
        points: [valid.points[0]],
      }),
    ).not.toBeNull();
  });

  test("one malformed day rejects the whole window", () => {
    // A partially parsed series would quietly misstate a trend.
    const broken = { ...valid, points: [valid.points[0], { day: "nope", activeInstalls: 1 }] };
    expect(parseDocsAnalyticsSeries(broken)).toBeNull();
  });

  test("negative or non-finite counts are refused", () => {
    expect(
      parseDocsAnalyticsSeries({
        ...valid,
        points: [{ ...valid.points[0], byVersion: { "0.3.0": -1 } }],
      }),
    ).toBeNull();
  });

  test("an empty or absent point list is not a series", () => {
    expect(parseDocsAnalyticsSeries({ ...valid, points: [] })).toBeNull();
    expect(parseDocsAnalyticsSeries({ ...valid, points: undefined })).toBeNull();
    expect(parseDocsAnalyticsSeries(null)).toBeNull();
    expect(parseDocsAnalyticsSeries("nope")).toBeNull();
  });
});

describe("versionBands", () => {
  test("bands come back in version order, not by size", () => {
    // The reader's question is "is the newest taking over" — sorting by
    // magnitude would destroy exactly that reading.
    const bands = versionBands(
      series([{ day: "2026-08-01", byVersion: { "0.3.1": 5, "0.2.9": 40, "0.3.0": 20 } }]),
    );
    expect(bands).toEqual(["0.2.9", "0.3.0", "0.3.1"]);
  });

  test("the band count is capped at the ramp's validated ceiling", () => {
    const byVersion = Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [`0.${i}.0`, (i + 1) * 10]),
    );
    const bands = versionBands(series([{ day: "2026-08-01", byVersion }]));
    expect(bands).toHaveLength(MAX_VERSION_BANDS);
  });

  test("the residual is never a band", () => {
    const bands = versionBands(series([{ day: "2026-08-01", byVersion: { other: 40 } }]));
    expect(bands).toEqual([]);
  });
});

describe("the fully suppressed case — the live one today", () => {
  test("a single install with everything folded reports as suppressed", () => {
    const live = series([{ day: "2026-08-25", active: 1, byVersion: { other: 1 } }]);
    expect(isFullySuppressed(live)).toBe(true);
  });

  test("one published band is enough to stop being suppressed", () => {
    expect(isFullySuppressed(series([{ day: "2026-08-25", byVersion: { "0.3.0": 9 } }]))).toBe(
      false,
    );
  });
});

describe("compareVersions", () => {
  test("sorts numerically, so 0.10.0 lands after 0.9.0", () => {
    expect(["0.10.0", "0.9.0", "0.2.5"].sort(compareVersions)).toEqual([
      "0.2.5",
      "0.9.0",
      "0.10.0",
    ]);
  });

  test("prerelease tags order after their release", () => {
    expect(compareVersions("0.3.0", "0.3.0-rc1")).toBeLessThan(0);
  });
});

describe("dayOffsets — spacing follows the calendar, not the array", () => {
  test("a cron outage does not compress into an even line", () => {
    // readRollups returns only days that HAVE a rollup, so a missed run leaves a
    // hole. Spacing by index would draw the 1-day gap and the 11-day gap the
    // same width and make the line misstate time.
    const offsets = dayOffsets(["2026-08-01", "2026-08-02", "2026-08-13"]);
    expect(offsets[0]).toBe(0);
    expect(offsets[2]).toBe(1);
    // 1 of 12 days elapsed, not 1 of 2 points.
    expect(offsets[1]).toBeCloseTo(1 / 12, 5);
    expect(offsets[1]).toBeLessThan(0.1);
  });

  test("evenly spaced days stay evenly spaced", () => {
    const offsets = dayOffsets(["2026-08-01", "2026-08-02", "2026-08-03"]);
    expect(offsets).toEqual([0, 0.5, 1]);
  });

  test("a single day sits mid-plot so its marker has room both sides", () => {
    expect(dayOffsets(["2026-08-01"])).toEqual([0.5]);
  });

  test("an empty window has no positions", () => {
    expect(dayOffsets([])).toEqual([]);
  });

  test("a zero-span window falls back to even spacing instead of dividing by zero", () => {
    const offsets = dayOffsets(["2026-08-01", "2026-08-01", "2026-08-01"]);
    expect(offsets).toEqual([0, 0.5, 1]);
    expect(offsets.every((o) => Number.isFinite(o))).toBe(true);
  });

  test("the window spans a month boundary correctly", () => {
    const offsets = dayOffsets(["2026-07-30", "2026-07-31", "2026-08-01"]);
    expect(offsets).toEqual([0, 0.5, 1]);
  });
});

describe("the parse boundary rejects what the x-scale cannot draw", () => {
  const days = (...list: string[]) =>
    parseDocsAnalyticsSeries({
      from: list[0],
      to: list.at(-1),
      updatedAt: "2026-08-26T00:00:00.000Z",
      points: list.map((day) => ({
        day,
        activeInstalls: 1,
        lifetimeInstalls: 1,
        byVersion: { "0.3.0": 1 },
      })),
    });

  test("a date that matches the format but is not a real day is refused", () => {
    // `Date.parse` returns NaN for these, and that NaN reaches the x-scale:
    // every path becomes `MNaN,NaN`, which browsers drop silently.
    expect(days("2026-13-45")).toBeNull();
    expect(days("2026-00-00")).toBeNull();
    expect(days("2026-02-30")).toBeNull();
    expect(days("2026-08-01")).not.toBeNull();
  });

  test("out-of-order days are refused rather than drawn off-plot", () => {
    // An earlier day after a later one yields a negative offset, and
    // `overflow: visible` paints that mark over the surrounding page.
    expect(days("2026-08-03", "2026-08-01")).toBeNull();
    expect(days("2026-08-01", "2026-08-03")).not.toBeNull();
  });

  test("a duplicated day is refused so the window cannot double-count", () => {
    expect(days("2026-08-01", "2026-08-01")).toBeNull();
  });
});

describe("dayOffsets is safe even when handed unparsed input", () => {
  test("an out-of-order day is clamped into the plot, never negative", () => {
    const offsets = dayOffsets(["2026-08-10", "2026-08-01", "2026-08-20"]);
    expect(offsets.every((o) => o >= 0 && o <= 1)).toBe(true);
  });

  test("an unparseable day never yields NaN", () => {
    const offsets = dayOffsets(["2026-08-01", "not-a-date", "2026-08-20"]);
    expect(offsets.every(Number.isFinite)).toBe(true);
  });
});
