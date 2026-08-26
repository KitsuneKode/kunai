import { describe, expect, test } from "bun:test";

import { createMemoryAnalyticsStore } from "../src/memory-store";
import { OTHER_BUCKET } from "../src/public-metrics";
import { buildPublicSeries, seriesStartDay } from "../src/public-series";

/**
 * The range read plus the series builder — the path `/metrics/series.json`
 * actually runs. The handler itself is thin glue over these two calls.
 */

async function seed(
  store: ReturnType<typeof createMemoryAnalyticsStore>,
  day: string,
  installs: readonly { hash: string; version: string; os: string; arch: string }[],
): Promise<void> {
  for (const install of installs) {
    await store.recordPing({
      day,
      installHash: install.hash,
      version: install.version,
      os: install.os,
      arch: install.arch,
    });
  }
  await store.rollUpDay(day);
}

function population(day: string, version: string, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    hash: `${day}-${version}-${i}`,
    version,
    os: "linux",
    arch: "x64",
  }));
}

describe("series over a real store", () => {
  test("a range read feeds a series covering exactly the seeded days", async () => {
    const store = createMemoryAnalyticsStore();
    await seed(store, "2026-08-01", population("2026-08-01", "0.3.0", 10));
    await seed(store, "2026-08-02", population("2026-08-02", "0.3.0", 12));
    await seed(store, "2026-08-03", population("2026-08-03", "0.3.0", 14));

    const rollups = await store.readRollups(seriesStartDay("2026-08-03", 3), "2026-08-03");
    const series = buildPublicSeries(rollups);

    expect(series).not.toBeNull();
    expect(series?.points.map((p) => p.day)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
    expect(series?.points.map((p) => p.activeInstalls)).toEqual([10, 12, 14]);
  });

  test("a version that dips below the floor stays folded across the whole window", async () => {
    const store = createMemoryAnalyticsStore();
    // 0.3.1 launches healthy, dips to 3, recovers.
    await seed(store, "2026-08-01", [
      ...population("2026-08-01", "0.3.0", 20),
      ...population("2026-08-01", "0.3.1", 8),
    ]);
    await seed(store, "2026-08-02", [
      ...population("2026-08-02", "0.3.0", 20),
      ...population("2026-08-02", "0.3.1", 3),
    ]);
    await seed(store, "2026-08-03", [
      ...population("2026-08-03", "0.3.0", 20),
      ...population("2026-08-03", "0.3.1", 9),
    ]);

    const rollups = await store.readRollups("2026-08-01", "2026-08-03");
    const series = buildPublicSeries(rollups);
    expect(series).not.toBeNull();
    if (!series) return;

    for (const point of series.points) {
      expect(point.byVersion["0.3.1"]).toBeUndefined();
      expect(point.byVersion[OTHER_BUCKET]).toBeGreaterThan(0);
    }
    // 0.3.0 is comfortably above the floor every day, so it still publishes.
    expect(series.points.every((p) => p.byVersion["0.3.0"] === 20)).toBe(true);
  });

  test("a version launching mid-window above the floor is published from its first day", async () => {
    const store = createMemoryAnalyticsStore();
    await seed(store, "2026-08-01", population("2026-08-01", "0.3.0", 30));
    await seed(store, "2026-08-02", [
      ...population("2026-08-02", "0.3.0", 20),
      ...population("2026-08-02", "0.3.1", 10),
    ]);

    const rollups = await store.readRollups("2026-08-01", "2026-08-02");
    const series = buildPublicSeries(rollups);

    expect(series?.points[0]?.byVersion["0.3.1"]).toBeUndefined();
    expect(series?.points[1]?.byVersion["0.3.1"]).toBe(10);
  });

  test("a window with no rollups yields no series rather than empty points", async () => {
    const store = createMemoryAnalyticsStore();
    const rollups = await store.readRollups("2026-01-01", "2026-01-07");
    expect(buildPublicSeries(rollups)).toBeNull();
  });

  test("every published day's buckets sum to that day's active installs", async () => {
    const store = createMemoryAnalyticsStore();
    await seed(store, "2026-08-01", [
      ...population("2026-08-01", "0.3.0", 20),
      ...population("2026-08-01", "0.3.1", 2),
    ]);

    const series = buildPublicSeries(await store.readRollups("2026-08-01", "2026-08-01"));
    const point = series?.points[0];
    expect(point).toBeDefined();
    if (!point) return;

    // Suppression moves counts between buckets; it must never lose them.
    const total = Object.values(point.byVersion).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(point.activeInstalls);
  });
});
