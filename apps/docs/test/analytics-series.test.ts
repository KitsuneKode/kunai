import { describe, expect, test } from "bun:test";

import {
  compareVersions,
  isFullySuppressed,
  MAX_VERSION_BANDS,
  parseDocsAnalyticsSeries,
  shareBands,
  type DocsAnalyticsSeries,
} from "../lib/analytics-series";

function series(
  points: readonly {
    day: string;
    active?: number;
    byVersion?: Record<string, number>;
    byOs?: Record<string, number>;
    byArch?: Record<string, number>;
  }[],
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
      byOs: p.byOs ?? { linux: 10 },
      byArch: p.byArch ?? { x64: 10 },
    })),
  };
}

describe("parseDocsAnalyticsSeries", () => {
  const valid = {
    from: "2026-08-01",
    to: "2026-08-02",
    updatedAt: "2026-08-02T00:05:00.000Z",
    points: [
      {
        day: "2026-08-01",
        activeInstalls: 10,
        lifetimeInstalls: 40,
        byVersion: { "0.3.0": 10 },
        byOs: { linux: 10 },
        byArch: { x64: 10 },
      },
      {
        day: "2026-08-02",
        activeInstalls: 12,
        lifetimeInstalls: 42,
        byVersion: { "0.3.0": 12 },
        byOs: { linux: 12 },
        byArch: { x64: 12 },
      },
    ],
  };

  test("a well-formed payload round-trips", () => {
    const parsed = parseDocsAnalyticsSeries(valid);
    expect(parsed?.points).toHaveLength(2);
    expect(parsed?.points[1]?.activeInstalls).toBe(12);
  });

  test("keeps the OS and architecture history, not just versions", () => {
    // The ingest has always published all three per day; this parser used to
    // keep byVersion and drop the other two on the floor.
    const parsed = parseDocsAnalyticsSeries(valid);
    expect(parsed?.points[0]?.byOs).toEqual({ linux: 10 });
    expect(parsed?.points[0]?.byArch).toEqual({ x64: 10 });
  });

  test("a malformed OS or arch breakdown rejects the day, like a version one", () => {
    const bad = (key: string) => ({
      ...valid,
      points: [{ ...valid.points[0], [key]: { linux: -1 } }, valid.points[1]],
    });
    expect(parseDocsAnalyticsSeries(bad("byOs"))).toBeNull();
    expect(parseDocsAnalyticsSeries(bad("byArch"))).toBeNull();
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

describe("shareBands", () => {
  test("bands come back in version order, not by size", () => {
    // The reader's question is "is the newest taking over" — sorting by
    // magnitude would destroy exactly that reading.
    const bands = shareBands(
      series([{ day: "2026-08-01", byVersion: { "0.3.1": 5, "0.2.9": 40, "0.3.0": 20 } }]),
    );
    expect(bands).toEqual(["0.2.9", "0.3.0", "0.3.1"]);
  });

  test("the band count is capped at the ramp's validated ceiling", () => {
    const byVersion = Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [`0.${i}.0`, (i + 1) * 10]),
    );
    const bands = shareBands(series([{ day: "2026-08-01", byVersion }]));
    expect(bands).toHaveLength(MAX_VERSION_BANDS);
  });

  test("the residual is never a band", () => {
    const bands = shareBands(series([{ day: "2026-08-01", byVersion: { other: 40 } }]));
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
        byOs: { linux: 1 },
        byArch: { x64: 1 },
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

describe("shareBands across dimensions", () => {
  const window = series([
    {
      day: "2026-08-01",
      byVersion: { "0.9.0": 6, "0.10.0": 9 },
      byOs: { linux: 9, darwin: 6 },
      byArch: { x64: 15 },
    },
  ]);

  test("versions stack in release order, not by size", () => {
    // The reader's question is "is the newest taking over", so 0.10.0 must sort
    // after 0.9.0 even though a plain string compare puts it first.
    expect(shareBands(window, "byVersion")).toEqual(["0.9.0", "0.10.0"]);
  });

  test("platform and architecture are nominal, so they sort by name", () => {
    expect(shareBands(window, "byOs")).toEqual(["darwin", "linux"]);
    expect(shareBands(window, "byArch")).toEqual(["x64"]);
  });

  test("suppression is judged per dimension", () => {
    const mixed = series([
      { day: "2026-08-01", byVersion: { other: 20 }, byOs: { linux: 20 }, byArch: { other: 20 } },
    ]);
    expect(isFullySuppressed(mixed, "byVersion")).toBe(true);
    expect(isFullySuppressed(mixed, "byOs")).toBe(false);
    expect(isFullySuppressed(mixed, "byArch")).toBe(true);
  });
});
