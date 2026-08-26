import { describe, expect, test } from "bun:test";

import { OTHER_BUCKET, SMALL_CELL_FLOOR } from "../src/public-metrics";
import {
  buildPublicSeries,
  clampSeriesDays,
  DEFAULT_SERIES_DAYS,
  MAX_SERIES_DAYS,
  seriesStartDay,
  windowPublishableBuckets,
} from "../src/public-series";
import type { DailyRollup } from "../src/store";

function rollup(day: string, over: Partial<DailyRollup> = {}): DailyRollup {
  return {
    day,
    computedAt: `${day}T00:05:00.000Z`,
    activeInstalls: 100,
    lifetimeInstalls: 400,
    byVersion: { "0.3.0": 100 },
    byOs: { linux: 60, darwin: 40 },
    byArch: { x64: 60, arm64: 40 },
    ...over,
  };
}

describe("windowPublishableBuckets", () => {
  test("a bucket under the floor on any single day is suppressed for the whole window", () => {
    const publishable = windowPublishableBuckets([
      { "0.3.0": 100, "0.3.1": 50 },
      { "0.3.0": 100, "0.3.1": SMALL_CELL_FLOOR - 1 },
      { "0.3.0": 100, "0.3.1": 80 },
    ]);
    expect(publishable.has("0.3.0")).toBe(true);
    // The dip is the whole point: publishing it on days 1 and 3 but not 2 would
    // announce that a small population crossed the threshold.
    expect(publishable.has("0.3.1")).toBe(false);
  });

  test("absence before a version launches does not disqualify it", () => {
    const publishable = windowPublishableBuckets([
      { "0.3.0": 100 },
      { "0.3.0": 100 },
      { "0.3.0": 60, "0.3.1": 40 },
    ]);
    // A version that did not exist yet is not a small cell.
    expect(publishable.has("0.3.1")).toBe(true);
  });

  test("a stored `other` residual is never publishable", () => {
    const publishable = windowPublishableBuckets([{ "0.3.0": 100, [OTHER_BUCKET]: 40 }]);
    expect(publishable.has(OTHER_BUCKET)).toBe(false);
  });

  test("an empty window publishes nothing", () => {
    expect(windowPublishableBuckets([]).size).toBe(0);
  });
});

describe("buildPublicSeries", () => {
  test("no rollups yields no series rather than an empty shell", () => {
    expect(buildPublicSeries([])).toBeNull();
  });

  test("a dipping version is folded into other on every day, including its healthy ones", () => {
    const series = buildPublicSeries([
      rollup("2026-08-01", { byVersion: { "0.3.0": 100, "0.3.1": 50 } }),
      rollup("2026-08-02", { byVersion: { "0.3.0": 100, "0.3.1": 2 } }),
    ]);
    expect(series).not.toBeNull();
    if (!series) return;

    for (const point of series.points) {
      expect(point.byVersion["0.3.1"]).toBeUndefined();
    }
    // Folding must preserve the total, not discard it.
    expect(series.points[0]?.byVersion[OTHER_BUCKET]).toBe(50);
    expect(series.points[1]?.byVersion[OTHER_BUCKET]).toBe(2);
  });

  test("a closed dimension is not recoverable by elimination on any day", () => {
    // arch has two values, so publishing x64 alongside a non-empty other would
    // name arm64 in as many words.
    const series = buildPublicSeries([rollup("2026-08-01", { byArch: { x64: 80, arm64: 2 } })]);
    expect(series).not.toBeNull();
    if (!series) return;

    const arch = series.points[0]?.byArch ?? {};
    expect(arch.x64).toBeUndefined();
    expect(arch.arm64).toBeUndefined();
    expect(arch[OTHER_BUCKET]).toBe(82);
  });

  test("unsorted rollups are ordered before the window bounds are read", () => {
    // from/to are read off the ends of the array, so an unsorted caller would
    // publish a window whose bounds disagree with its own contents.
    const series = buildPublicSeries([
      rollup("2026-08-10"),
      rollup("2026-08-01"),
      rollup("2026-08-20"),
    ]);
    expect(series?.from).toBe("2026-08-01");
    expect(series?.to).toBe("2026-08-20");
    expect(series?.points.map((p) => p.day)).toEqual(["2026-08-01", "2026-08-10", "2026-08-20"]);
  });

  test("day ordering and window bounds come straight from the rollups", () => {
    const series = buildPublicSeries([rollup("2026-08-01"), rollup("2026-08-02")]);
    expect(series?.from).toBe("2026-08-01");
    expect(series?.to).toBe("2026-08-02");
    expect(series?.points.map((p) => p.day)).toEqual(["2026-08-01", "2026-08-02"]);
  });

  test("updatedAt reports the newest computedAt in the window", () => {
    const series = buildPublicSeries([
      rollup("2026-08-01", { computedAt: "2026-08-01T00:05:00.000Z" }),
      rollup("2026-08-02", { computedAt: "2026-08-02T00:05:00.000Z" }),
    ]);
    expect(series?.updatedAt).toBe("2026-08-02T00:05:00.000Z");
  });

  test("a single day is a valid series — a fresh deploy must still render", () => {
    const series = buildPublicSeries([rollup("2026-08-01")]);
    expect(series?.points).toHaveLength(1);
    expect(series?.from).toBe(series?.to);
  });

  test("counts are floored to integers and never negative", () => {
    const series = buildPublicSeries([
      rollup("2026-08-01", { activeInstalls: 12.7, lifetimeInstalls: -3 }),
    ]);
    expect(series?.points[0]?.activeInstalls).toBe(12);
    expect(series?.points[0]?.lifetimeInstalls).toBe(0);
  });
});

describe("window bounds", () => {
  test("an absent or unusable days query falls back to the default", () => {
    expect(clampSeriesDays(undefined)).toBe(DEFAULT_SERIES_DAYS);
    expect(clampSeriesDays("")).toBe(DEFAULT_SERIES_DAYS);
    expect(clampSeriesDays("nonsense")).toBe(DEFAULT_SERIES_DAYS);
    expect(clampSeriesDays("0")).toBe(DEFAULT_SERIES_DAYS);
    expect(clampSeriesDays("-7")).toBe(DEFAULT_SERIES_DAYS);
  });

  test("a caller cannot ask for more than the maximum window", () => {
    expect(clampSeriesDays("100000")).toBe(MAX_SERIES_DAYS);
    expect(clampSeriesDays("30")).toBe(30);
  });

  test("the start day is inclusive of the end day", () => {
    expect(seriesStartDay("2026-08-10", 1)).toBe("2026-08-10");
    expect(seriesStartDay("2026-08-10", 3)).toBe("2026-08-08");
  });

  test("the window spans month and year boundaries", () => {
    expect(seriesStartDay("2026-03-02", 3)).toBe("2026-02-28");
    expect(seriesStartDay("2026-01-01", 2)).toBe("2025-12-31");
  });
});
