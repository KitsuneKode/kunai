import { describe, expect, test } from "bun:test";

import { buildPublicMetrics } from "../../analytics-ingest/src/public-metrics";
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

/**
 * The fixtures above are hand-written, so they prove the parser is strict but
 * not that it accepts what the ingest actually emits. This joins the last leg
 * of the chain — the CLI-to-ingest half lives in
 * `apps/cli/test/integration/analytics-wire-contract.test.ts`.
 */
describe("ingest output is accepted by the docs parser", () => {
  const rollup = {
    day: "2026-08-13",
    computedAt: "2026-08-14T00:05:00.000Z",
    activeInstalls: 3,
    byVersion: { "0.3.0": 2, "0.2.5": 1 },
    byOs: { linux: 2, darwin: 1 },
    byArch: { x64: 2, arm64: 1 },
    lifetimeInstalls: 9,
  };

  test("real published metrics parse and keep their values", () => {
    const published = buildPublicMetrics(rollup);
    const overWire: unknown = JSON.parse(JSON.stringify(published));
    const parsed = parseDocsAnalyticsMetrics(overWire);

    expect(parsed).not.toBeNull();
    expect(parsed?.schemaVersion).toBe(2);
    expect(parsed?.activeInstalls).toBe(3);
    expect(parsed?.lifetimeInstalls).toBe(9);
    // Every bucket here is under the small-cell floor, so the ingest folds
    // them all into `other` before the site ever sees them.
    expect(parsed?.byOs).toEqual({ other: 3 });
  });

  test("the home line renders from real published output", () => {
    const published = buildPublicMetrics(rollup);
    const parsed = parseDocsAnalyticsMetrics(JSON.parse(JSON.stringify(published)) as unknown);
    expect(parsed).not.toBeNull();
    expect(formatUsageLine(parsed as NonNullable<typeof parsed>)).toContain("3");
  });
});
