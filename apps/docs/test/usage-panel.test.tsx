import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  AnalyticsMetricsEmpty,
  AnalyticsZeroDayEmpty,
  UsagePanel,
} from "../components/analytics/usage-panel";

const sample = {
  schemaVersion: 2 as const,
  day: "2026-08-13",
  activeInstalls: 128,
  lifetimeInstalls: 512,
  byVersion: { "0.3.0": 96, other: 32 },
  byOs: { linux: 80, darwin: 48 },
  byArch: { x64: 96, arm64: 32 },
  updatedAt: "2026-08-14T00:05:00.000Z",
};

describe("usage panel", () => {
  test("renders empty state when metrics are unavailable", () => {
    const html = renderToStaticMarkup(<UsagePanel metrics={null} />);
    expect(html).toContain("Public pulse not published yet");
    expect(html).toContain("Exact wire payload");
    expect(html).not.toContain("Public usage pulse");
  });

  test("renders metrics heroes and zero-day empty when actives are zero", () => {
    const html = renderToStaticMarkup(<UsagePanel metrics={{ ...sample, activeInstalls: 0 }} />);
    expect(html).toContain("No pings for 2026-08-13");
    expect(html).toContain("Yesterday");
    expect(html).toContain("Lifetime installs");
  });

  test("renders populated pulse without empty copy", () => {
    const html = renderToStaticMarkup(<UsagePanel metrics={sample} />);
    expect(html).toContain("128");
    expect(html).toContain("512");
    expect(html).not.toContain("Public pulse not published yet");
    expect(html).not.toContain("No pings for");
  });

  test("renders the version, os, and arch breakdowns", () => {
    const html = renderToStaticMarkup(<UsagePanel metrics={sample} />);
    expect(html).toContain("By version");
    expect(html).toContain("By OS");
    expect(html).toContain("By architecture");
    expect(html).toContain("0.3.0");
    expect(html).toContain("linux");
    expect(html).toContain("darwin");
    expect(html).toContain("x64");
    expect(html).toContain("arm64");
    expect(html).toContain("Groups smaller than 5 installs are reported as");
  });

  test("empty blocks expose recovery links", () => {
    expect(renderToStaticMarkup(<AnalyticsMetricsEmpty />)).toContain(
      "reliability-and-privacy#usage-analytics",
    );
    expect(renderToStaticMarkup(<AnalyticsZeroDayEmpty day="2026-08-13" />)).toContain(
      "2026-08-13",
    );
  });
});
