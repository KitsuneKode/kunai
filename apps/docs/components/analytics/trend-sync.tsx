"use client";

import { ChartInstalls } from "@/components/analytics/chart-installs";
import { ShareSection } from "@/components/analytics/share-section";
import { TrendTable } from "@/components/analytics/trend-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DocsAnalyticsSeries } from "@/lib/analytics-series";
import * as React from "react";

/**
 * The over-time surface, wired into one surface instead of two neighbours.
 *
 * Chart → table sync, one direction only, and that is the right way round:
 * the chart is not keyboard-navigable (recharts SVG + pointer events), while
 * the table is the keyboard and screen-reader path. So the chart *locates* —
 * hover a day and its row highlights and scrolls into view, revealing chunks
 * as needed — and the table *reads*. A table → chart crosshair has no clean
 * recharts hook and would buy little; it is deliberately out.
 *
 * `hoveredDay` is one string of state; no debounce needed.
 */
export function TrendSync({ series }: { readonly series: DocsAnalyticsSeries }) {
  const [hoveredDay, setHoveredDay] = React.useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <ChartInstalls
        points={series.points}
        from={series.from}
        to={series.to}
        onDayHover={setHoveredDay}
      />

      <div className="grid gap-4 @4xl/analytics:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <ShareSection series={series} />

        {/*
          `id` anchors the "Reporting window" stat card to this table, and
          `scroll-mt` keeps it below the sticky docs header on jump.
        */}
        <Card id="day-by-day" className="@container/card scroll-mt-24">
          <CardHeader>
            <CardTitle>Day by day</CardTitle>
            <CardDescription>
              Every plotted value, as text — the chart’s accessible twin.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TrendTable points={series.points} hoveredDay={hoveredDay} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
