import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";

import { HowToRead } from "../components/analytics/how-to-read";
import { NpmSection } from "../components/analytics/npm-downloads";
import { toggleVariants } from "../components/ui/toggle";
import type { NpmDownloadSeries } from "../lib/analytics-npm";
import type { DocsAnalyticsSeries, SeriesPoint } from "../lib/analytics-series";
import { scrollDeltaToReveal } from "../lib/reveal-in-container";

const APP_ROOT = path.resolve(import.meta.dir, "..");

function point(day: string, active: number, lifetime: number): SeriesPoint {
  return {
    day,
    activeInstalls: active,
    newInstalls: 1,
    lifetimeInstalls: lifetime,
    byVersion: {},
    byOs: {},
    byArch: {},
  };
}

describe("scrollDeltaToReveal", () => {
  const view = { top: 100, bottom: 360 };

  test("does nothing for a row that is already visible, so the panel never moves", () => {
    expect(scrollDeltaToReveal({ top: 150, bottom: 175 }, view)).toBe(0);
  });

  test("scrolls up by exactly the hidden amount for a row above the panel", () => {
    expect(scrollDeltaToReveal({ top: 80, bottom: 105 }, view)).toBe(-20);
  });

  test("scrolls down by exactly the hidden amount for a row below the panel", () => {
    expect(scrollDeltaToReveal({ top: 350, bottom: 380 }, view)).toBe(20);
  });

  test("treats a row behind the sticky header as hidden", () => {
    // The header covers the top 30px of the panel, so a row at 110 is under it.
    expect(scrollDeltaToReveal({ top: 110, bottom: 135 }, view, 30)).toBe(-20);
    expect(scrollDeltaToReveal({ top: 130, bottom: 155 }, view, 30)).toBe(0);
  });

  test("the table never calls scrollIntoView, which scrolls the whole page", () => {
    const table = fs.readFileSync(
      path.join(APP_ROOT, "components/analytics/trend-table.tsx"),
      "utf-8",
    );
    expect(table).not.toMatch(/scrollIntoView\(/);
    expect(table).toContain("revealWithin(");
  });
});

describe("toggle selected state", () => {
  const classes = toggleVariants({ variant: "outline", size: "sm" });

  test("a pressed toggle is tinted and ringed with the accent, not a barely-there muted fill", () => {
    expect(classes).toContain("aria-pressed:bg-[color-mix(in_oklab,var(--kunai-accent)_16%");
    expect(classes).toContain(
      "aria-pressed:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--kunai-accent)",
    );
    expect(classes).not.toContain("aria-pressed:bg-muted");
  });

  test("a pressed toggle sits above its neighbours so the ring is not clipped", () => {
    expect(classes).toContain("aria-pressed:z-[1]");
  });
});

describe("HowToRead", () => {
  const series: DocsAnalyticsSeries = {
    from: "2026-09-30",
    to: "2026-10-02",
    updatedAt: "2026-10-03T00:00:00Z",
    points: [point("2026-09-30", 6, 119), point("2026-10-02", 4, 121)],
  };

  test("works its example from the newest published day, not a made-up one", () => {
    const html = renderToStaticMarkup(<HowToRead series={series} />);
    expect(html).toContain("On 2026-10-02, 4 installs ran Kunai and 121");
    expect(html).toContain("3.3%");
  });

  test("answers the questions the numbers raise", () => {
    const html = renderToStaticMarkup(<HowToRead series={series} />);
    for (const term of ["Active", "New", "Lifetime", "Other", "Days", "Installs, not people"]) {
      expect(html).toContain(term);
    }
    expect(html).toContain("18.5 hours");
    expect(html).toContain("fewer than five installs");
    expect(html).toContain("not a retention rate");
  });

  test("still explains the definitions when there is no series to draw an example from", () => {
    const html = renderToStaticMarkup(<HowToRead series={null} />);
    expect(html).toContain("How to read these numbers");
    expect(html).not.toContain("On 20");
  });
});

describe("NpmSection", () => {
  const npm: NpmDownloadSeries = {
    package: "@kitsunekode/kunai",
    from: "2026-09-02",
    to: "2026-09-06",
    points: [
      { day: "2026-09-02", downloads: 157 },
      { day: "2026-09-03", downloads: 4 },
      { day: "2026-09-04", downloads: 6 },
      { day: "2026-09-05", downloads: 2 },
      { day: "2026-09-06", downloads: 8 },
    ],
  };

  test("states total, typical day and busiest day as three separate figures", () => {
    const html = renderToStaticMarkup(<NpmSection series={npm} />);
    expect(html).toContain(">177<");
    // The median, so the launch day cannot drag the "typical" figure up with it.
    expect(html).toContain(">6<");
    expect(html).toContain(">157<");
    expect(html).toContain("2026-09-02");
  });

  test("never presents itself as an install count", () => {
    const html = renderToStaticMarkup(<NpmSection series={npm} />);
    expect(html).toContain("A channel pulse, not an install count");
  });

  test("renders nothing without a series", () => {
    expect(renderToStaticMarkup(<NpmSection series={null} />)).toBe("");
  });
});
