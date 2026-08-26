import { describe, expect, test } from "bun:test";

import {
  compareVersions,
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
