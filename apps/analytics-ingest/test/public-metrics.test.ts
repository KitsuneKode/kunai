import { describe, expect, test } from "bun:test";

import {
  buildPublicMetrics,
  SMALL_CELL_FLOOR,
  METRICS_SCHEMA_VERSION,
  parsePublicMetrics,
  snapshotDayKey,
  suppressSmallBuckets,
} from "../src/public-metrics";

const rollup = {
  day: "2026-08-13",
  computedAt: "2026-08-14T00:05:00.000Z",
  activeInstalls: 128,
  byVersion: { "0.3.0": 96, "0.2.5": 30, "0.1.0": 2 },
  byOs: { linux: 80, darwin: 44, win32: 4 },
  byArch: { x64: 96, arm64: 32 },
  lifetimeInstalls: 512,
};

describe("small-cell suppression", () => {
  test("floor is 5", () => {
    expect(SMALL_CELL_FLOOR).toBe(5);
  });

  test("buckets under the floor fold into other", () => {
    expect(suppressSmallBuckets({ a: 10, b: 3, c: 1 })).toEqual({ a: 10, other: 4 });
  });

  test("no other key when nothing is suppressed", () => {
    expect(suppressSmallBuckets({ a: 10, b: 7 })).toEqual({ a: 10, b: 7 });
  });

  test("a bucket exactly at the floor is kept", () => {
    expect(suppressSmallBuckets({ a: 10, b: 5 })).toEqual({ a: 10, b: 5 });
  });

  test("suppression never changes the total", () => {
    const before = Object.values(rollup.byOs).reduce((a, b) => a + b, 0);
    const after = Object.values(suppressSmallBuckets(rollup.byOs)).reduce((a, b) => a + b, 0);
    expect(after).toBe(before);
  });
});

describe("public metrics v2", () => {
  test("reports stale cron time instead of refreshing updatedAt at read time", () => {
    const metrics = buildPublicMetrics({ ...rollup, computedAt: "2026-08-14T00:05:00.000Z" });
    expect(metrics.updatedAt).toBe("2026-08-14T00:05:00.000Z");
  });

  test("suppresses small buckets and drops lifetimeMethod", () => {
    const metrics = buildPublicMetrics(rollup);
    expect(metrics.schemaVersion).toBe(2);
    expect(metrics.byVersion).toEqual({ "0.3.0": 96, "0.2.5": 30, other: 2 });
    expect(metrics.byOs).toEqual({ linux: 80, darwin: 44, other: 4 });
    expect(metrics.byArch).toEqual({ x64: 96, arm64: 32 });
    expect(metrics.lifetimeInstalls).toBe(512);
    // The storage detail that used to leak into a public wire format.
    expect(metrics).not.toHaveProperty("lifetimeMethod");
  });

  test("round-trips through parse", () => {
    const metrics = buildPublicMetrics(rollup);
    expect(parsePublicMetrics(JSON.parse(JSON.stringify(metrics)) as unknown)).toEqual(metrics);
  });

  test("rejects a v1 snapshot and any unexpected key", () => {
    expect(
      parsePublicMetrics({
        schemaVersion: 1,
        day: "2026-08-13",
        activeInstalls: 1,
        lifetimeInstallsApprox: 1,
        lifetimeMethod: "hyperloglog",
        updatedAt: "2026-08-14T00:00:00.000Z",
      }),
    ).toBeNull();

    const metrics = buildPublicMetrics(rollup);
    expect(parsePublicMetrics({ ...metrics, sneaky: 1 })).toBeNull();
  });

  test("rejects malformed counts and days", () => {
    const metrics = buildPublicMetrics(rollup);
    expect(parsePublicMetrics({ ...metrics, day: "14-08-2026" })).toBeNull();
    expect(parsePublicMetrics({ ...metrics, activeInstalls: -1 })).toBeNull();
    expect(parsePublicMetrics({ ...metrics, byOs: { linux: "many" } })).toBeNull();
  });

  test("schema version constant is 2", () => {
    expect(METRICS_SCHEMA_VERSION).toBe(2);
  });
});

describe("snapshotDayKey", () => {
  test("is the UTC day before now", () => {
    expect(snapshotDayKey(Date.UTC(2026, 7, 14, 0, 5, 0))).toBe("2026-08-13");
  });
});
