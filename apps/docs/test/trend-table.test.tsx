import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { SectionCards } from "../components/analytics/section-cards";
import { ShareBars } from "../components/analytics/share-bars";
import { TrendSection } from "../components/analytics/trend-section";
import {
  TREND_TABLE_PAGE_SIZE,
  TrendTable,
  visibleCountForDay,
} from "../components/analytics/trend-table";
import { SNAPSHOT_STALE_AFTER_MS, UsagePanel } from "../components/analytics/usage-panel";
import type { DocsAnalyticsSeries } from "../lib/analytics-series";
import type { SeriesPoint } from "../lib/analytics-series";

/**
 * These tests run where every other docs test runs: SSR markup and pure
 * functions. The docs app has no DOM harness, so click-through and hover
 * wiring are not automated here — what IS covered is the logic those
 * handlers delegate to (chunk size, expansion math, ordering) plus the
 * no-JS floor, which is the contract that actually matters.
 */

function makePoints(count: number): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  const start = Date.parse("2026-06-01T00:00:00.000Z");
  for (let i = 0; i < count; i++) {
    const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    points.push({
      day,
      activeInstalls: i,
      newInstalls: null,
      lifetimeInstalls: 100 + i,
      byVersion: {},
      byOs: {},
      byArch: {},
    });
  }
  return points;
}

const metrics = {
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
  points: makePoints(3).map((point, i) => ({
    ...point,
    day: `2026-08-${11 + i}`,
  })),
};

describe("trend table", () => {
  test("renders newest day first under the sticky header", () => {
    const points = makePoints(90);
    const html = renderToStaticMarkup(<TrendTable points={points} />);
    const newest = String(points.at(-1)?.day);
    const secondNewest = String(points.at(-2)?.day);
    // The newest day precedes the second-newest in row order…
    expect(html.indexOf(newest)).toBeGreaterThanOrEqual(0);
    expect(html.indexOf(newest)).toBeLessThan(html.indexOf(secondNewest));
    // …and the oldest day is not rendered at all — it is past the first chunk.
    expect(html).not.toContain(String(points[0]?.day));
  });

  test("initial render is capped at PAGE_SIZE and offers one month more", () => {
    const html = renderToStaticMarkup(<TrendTable points={makePoints(90)} />);
    const rows = html.match(/kunai-chart-row/g) ?? [];
    expect(rows).toHaveLength(TREND_TABLE_PAGE_SIZE);
    expect(html).toContain("Show 30 more days");
  });

  test("a window at or under PAGE_SIZE renders no reveal control", () => {
    const html = renderToStaticMarkup(<TrendTable points={makePoints(12)} />);
    const rows = html.match(/kunai-chart-row/g) ?? [];
    expect(rows).toHaveLength(12);
    expect(html).not.toContain("Show 30 more days");
    expect(html).not.toContain("All 12 days shown");
  });

  test("the SSR'd first chunk is the newest month — the no-JS floor", () => {
    const points = makePoints(90);
    const html = renderToStaticMarkup(<TrendTable points={points} />);
    // Every one of the newest 30 days is in the initial HTML; day 31 back is not.
    for (const point of points.slice(-TREND_TABLE_PAGE_SIZE)) {
      expect(html).toContain(point.day);
    }
    expect(html).not.toContain(points[points.length - TREND_TABLE_PAGE_SIZE - 1]?.day ?? "");
  });

  test("rendering never mutates the shared points array", () => {
    const points = makePoints(90);
    const before = points.map((p) => p.day);
    renderToStaticMarkup(<TrendTable points={points} />);
    // The charts share this array — an in-place reverse would flip every axis.
    expect(points.map((p) => p.day)).toEqual(before);
  });
});

describe("visibleCountForDay", () => {
  const rows = [...makePoints(90)].reverse();

  test("a day inside the rendered chunk leaves the count alone", () => {
    expect(visibleCountForDay(rows, rows[0]?.day ?? "", 30)).toBe(30);
    expect(visibleCountForDay(rows, rows[29]?.day ?? "", 30)).toBe(30);
  });

  test("a day past the chunk expands exactly far enough to render it", () => {
    expect(visibleCountForDay(rows, rows[30]?.day ?? "", 30)).toBe(31);
    expect(visibleCountForDay(rows, rows[89]?.day ?? "", 30)).toBe(90);
  });

  test("null and absent days change nothing", () => {
    expect(visibleCountForDay(rows, null, 30)).toBe(30);
    expect(visibleCountForDay(rows, "1999-01-01", 30)).toBe(30);
  });
});

describe("trend section wiring", () => {
  test("SSR markup still contains the newest chunk inside #day-by-day", () => {
    const html = renderToStaticMarkup(<TrendSection series={series} />);
    expect(html).toContain('id="day-by-day"');
    expect(html).toContain("2026-08-13");
    expect(html).toContain("Day by day");
  });
});

describe("platform columns", () => {
  const withOs = makePoints(3).map(
    (point, i): SeriesPoint => ({
      ...point,
      byOs: i === 2 ? { linux: 6, darwin: 5, other: 2 } : { other: point.activeInstalls },
    }),
  );

  test("a named OS bucket earns its column; an under-floor day reads a dash", () => {
    const html = renderToStaticMarkup(<TrendTable points={withOs} />);
    // Headers carry the readable names, not the ingest's platform identifiers.
    expect(html).toContain(">Linux<");
    expect(html).toContain(">macOS<");
    expect(html).toContain(">Other<");
    // The two suppressed days contribute `other` only — linux reads a dash,
    // which says "under the naming floor", not zero.
    const suppressedDay = html.slice(html.indexOf(withOs[0]?.day ?? ""));
    expect(suppressedDay).toContain("—");
  });

  test("a window with empty byOs renders no platform columns at all", () => {
    // makePoints carries no OS buckets — the table must not promise a series
    // that is empty end to end.
    const html = renderToStaticMarkup(<TrendTable points={makePoints(4)} />);
    expect(html).not.toContain(">Linux<");
    expect(html).not.toContain(">Other<");
  });
});

describe("version buckets link to release pages", () => {
  test("a real version links to its release notes; residual and unknown do not", () => {
    const html = renderToStaticMarkup(
      <ShareBars label="By version" counts={{ "0.3.0": 96, "9.9.9": 6, other: 32 }} />,
    );
    expect(html).toContain('href="/releases/v0.3.0"');
    expect(html).not.toContain('href="/releases/v9.9.9"');
    expect(html).not.toContain('href="/releases/vother"');
    expect(html).toContain("9.9.9");
  });

  test("OS and arch labels never produce release links", () => {
    const html = renderToStaticMarkup(
      <ShareBars label="By OS" counts={{ linux: 80, darwin: 48 }} />,
    );
    expect(html).not.toContain("/releases/");
  });
});

describe("reporting window anchor", () => {
  test("the window tile links to the day-by-day table", () => {
    const html = renderToStaticMarkup(<SectionCards metrics={metrics} series={series} />);
    expect(html).toContain('href="#day-by-day"');
  });

  test("no series means nothing to anchor to", () => {
    const html = renderToStaticMarkup(<SectionCards metrics={metrics} series={null} />);
    expect(html).not.toContain('href="#day-by-day"');
    expect(html).toContain("History not published yet");
  });
});

describe("staleness badge", () => {
  test("a snapshot older than the threshold is marked stale", () => {
    const old = new Date(Date.now() - SNAPSHOT_STALE_AFTER_MS - 3_600_000).toISOString();
    const html = renderToStaticMarkup(
      <UsagePanel metrics={{ ...metrics, updatedAt: old }} series={series} />,
    );
    expect(html).toContain("data may be stale");
  });

  test("a fresh snapshot renders no stale marker", () => {
    const fresh = new Date(Date.now() - 3_600_000).toISOString();
    const html = renderToStaticMarkup(
      <UsagePanel metrics={{ ...metrics, updatedAt: fresh }} series={series} />,
    );
    expect(html).not.toContain("data may be stale");
  });
});
