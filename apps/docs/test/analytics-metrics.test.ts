import { describe, expect, test } from "bun:test";

import { formatUsageLine, parseDocsAnalyticsMetrics } from "../lib/analytics-metrics";

const v2 = {
  schemaVersion: 2 as const,
  day: "2026-08-13",
  activeInstalls: 128,
  lifetimeInstalls: 512,
  byVersion: { "0.3.0": 96, other: 32 },
  byOs: { linux: 80, darwin: 48 },
  byArch: { x64: 96, arm64: 32 },
  updatedAt: "2026-08-14T00:05:00.000Z",
};

describe("docs analytics metrics", () => {
  test("accepts a v2 snapshot", () => {
    expect(parseDocsAnalyticsMetrics(v2)).toEqual(v2);
  });

  test("rejects v1 and unexpected keys", () => {
    expect(
      parseDocsAnalyticsMetrics({
        schemaVersion: 1,
        day: "2026-08-13",
        activeInstalls: 1,
        lifetimeInstallsApprox: 1,
        lifetimeMethod: "hyperloglog",
        updatedAt: "2026-08-14T00:00:00.000Z",
      }),
    ).toBeNull();
    expect(parseDocsAnalyticsMetrics({ ...v2, sneaky: 1 })).toBeNull();
  });

  test("the home line names both numbers", () => {
    expect(formatUsageLine(v2)).toContain("128");
    expect(formatUsageLine(v2)).toContain("512");
  });
});
