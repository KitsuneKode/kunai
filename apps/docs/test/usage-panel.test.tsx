import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { SectionCards } from "../components/analytics/section-cards";
import {
  AnalyticsMetricsEmpty,
  AnalyticsZeroDayEmpty,
  BreakdownSection,
  TrustSection,
  UsagePanel,
} from "../components/analytics/usage-panel";
import type { DocsAnalyticsSeries } from "../lib/analytics-series";

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

const series: DocsAnalyticsSeries = {
  from: "2026-08-11",
  to: "2026-08-13",
  updatedAt: "2026-08-14T00:05:00.000Z",
  points: [
    { day: "2026-08-11", activeInstalls: 100, lifetimeInstalls: 480, byVersion: { "0.3.0": 100 } },
    { day: "2026-08-12", activeInstalls: 120, lifetimeInstalls: 500, byVersion: { "0.3.0": 120 } },
    { day: "2026-08-13", activeInstalls: 128, lifetimeInstalls: 512, byVersion: { "0.3.0": 128 } },
  ],
};

describe("usage panel", () => {
  test("renders empty state when metrics are unavailable", () => {
    const html = renderToStaticMarkup(<UsagePanel metrics={null} series={null} />);
    expect(html).toContain("Public pulse not published yet");
    expect(html).not.toContain("Lifetime installs");
  });

  test("renders the zero-day empty when actives are zero", () => {
    const html = renderToStaticMarkup(
      <UsagePanel metrics={{ ...sample, activeInstalls: 0 }} series={series} />,
    );
    expect(html).toContain("No pings for 2026-08-13");
  });

  test("renders the snapshot header without empty copy", () => {
    const html = renderToStaticMarkup(<UsagePanel metrics={sample} series={series} />);
    expect(html).toContain("2026-08-13");
    expect(html).toContain("schema v2");
    expect(html).not.toContain("Public pulse not published yet");
    expect(html).not.toContain("No pings for");
  });
});

describe("section cards", () => {
  test("leads with both install figures", () => {
    const html = renderToStaticMarkup(<SectionCards metrics={sample} series={series} />);
    expect(html).toContain("512");
    expect(html).toContain("128");
    expect(html).toContain("Lifetime installs");
    expect(html).toContain("Active yesterday");
  });

  test("signs the lifetime delta against the window start", () => {
    // 512 now, 480 on the first day of the window.
    const html = renderToStaticMarkup(<SectionCards metrics={sample} series={series} />);
    expect(html).toContain("+32");
  });

  test("signs the active delta against the previous day", () => {
    // 128 yesterday, 120 the day before.
    const html = renderToStaticMarkup(<SectionCards metrics={sample} series={series} />);
    expect(html).toContain("+8");
  });

  test("reports the suppressed share and the window length", () => {
    const html = renderToStaticMarkup(<SectionCards metrics={sample} series={series} />);
    // byVersion is 96 named + 32 other = 25% residual.
    expect(html).toContain("25%");
    expect(html).toContain("3 days");
  });

  test("a retention-adjusted FALL in lifetime reads as a fall, not as steady", () => {
    // The ingest retention-adjusts lifetimeInstalls, so it is not monotonic:
    // a window can end lower than it started. The badge already renders "-30";
    // the headline must not say "Steady across the window" beside it.
    const html = renderToStaticMarkup(
      <SectionCards metrics={{ ...sample, lifetimeInstalls: 450 }} series={series} />,
    );
    expect(html).toContain("-30");
    expect(html).toContain("retired installs were pruned");
    expect(html).not.toContain("Steady across the window");
  });

  test("an unchanged lifetime reads as steady", () => {
    const html = renderToStaticMarkup(
      <SectionCards metrics={{ ...sample, lifetimeInstalls: 480 }} series={series} />,
    );
    expect(html).toContain("Steady across the window");
  });

  test("renders without a series, dropping only the deltas", () => {
    const html = renderToStaticMarkup(<SectionCards metrics={sample} series={null} />);
    expect(html).toContain("512");
    expect(html).toContain("History not published yet");
  });

  test("renders nothing at all without metrics", () => {
    expect(renderToStaticMarkup(<SectionCards metrics={null} series={series} />)).toBe("");
  });
});

describe("breakdown section", () => {
  test("renders the version, os, and arch breakdowns", () => {
    const html = renderToStaticMarkup(<BreakdownSection metrics={sample} />);
    expect(html).toContain("By version");
    expect(html).toContain("By OS");
    expect(html).toContain("By architecture");
    expect(html).toContain("0.3.0");
    expect(html).toContain("linux");
    expect(html).toContain("darwin");
    expect(html).toContain("x64");
    expect(html).toContain("arm64");
  });

  test("breakdowns render as bars with every value also printed", () => {
    const html = renderToStaticMarkup(<BreakdownSection metrics={sample} />);
    const bars = html.match(/kunai-chart-bar/g) ?? [];
    // 2 + 2 + 2 buckets across the three breakdowns.
    expect(bars).toHaveLength(6);
    expect(html).toContain("96");
    expect(html).toContain("80");
  });

  test("a fully suppressed breakdown states the count instead of drawing one grey bar", () => {
    const html = renderToStaticMarkup(
      <BreakdownSection
        metrics={{ ...sample, byOs: { other: 2 }, byVersion: { other: 2 }, byArch: { other: 2 } }}
      />,
    );
    expect(html).not.toContain("kunai-chart-bar");
    expect(html).toContain("below the reporting floor");
    expect(html).toContain("A bucket needs 5 installs before it is named here.");
  });

  test("renders nothing without metrics", () => {
    expect(renderToStaticMarkup(<BreakdownSection metrics={null} />)).toBe("");
  });
});

describe("trust section", () => {
  test("keeps the payload contract and the CLI controls reachable", () => {
    const html = renderToStaticMarkup(<TrustSection />);
    expect(html).toContain("Exact wire payload");
    expect(html).toContain("installId");
    expect(html).toContain("DO_NOT_TRACK=1");
    expect(html).toContain("/analytics show");
    expect(html).toContain("What Kunai promises");
  });
});

describe("empty states", () => {
  test("metrics empty points at the privacy docs", () => {
    const html = renderToStaticMarkup(<AnalyticsMetricsEmpty />);
    expect(html).toContain("Read the privacy rules");
  });

  test("zero-day empty names the day", () => {
    const html = renderToStaticMarkup(<AnalyticsZeroDayEmpty day="2026-08-13" />);
    expect(html).toContain("2026-08-13");
  });
});
