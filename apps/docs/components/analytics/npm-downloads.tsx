"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { dayToEpoch, formatDayTick } from "@/lib/analytics-derive";
import type { NpmDownloadSeries } from "@/lib/analytics-npm";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

/**
 * The npm install channel, on its own card — not a tab on the installs chart.
 *
 * It is a different kind of number: the registry counts tarball fetches, not
 * installs, and its days are UTC rather than the analytics IST grid. A tab on
 * the shared chart would put it on the same axis as measured installs and
 * imply a relationship that does not exist; its own card with its own label
 * keeps the two honest.
 *
 * Bars, not an area: a day's count is a discrete fetch total, and a connected
 * area would draw a continuity between days that download counters do not
 * have.
 */

const chartConfig = {
  downloads: {
    label: "npm downloads",
    color: "var(--kunai-chart-npm)",
  },
} satisfies ChartConfig;

export function NpmDownloads({ series }: { readonly series: NpmDownloadSeries }) {
  const data = series.points.map((point) => ({
    t: dayToEpoch(point.day),
    downloads: point.downloads,
  }));

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>npm downloads</CardTitle>
        <CardDescription>
          Registry tarball fetches per UTC day · {series.from} → {series.to}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-[140px] w-full"
          initialDimension={{ width: 0, height: 140 }}
        >
          <BarChart data={data} margin={{ left: 4, right: 20, top: 4 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={formatDayTick}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={28}
              allowDecimals={false}
              tickMargin={4}
            />
            <ChartTooltip
              cursor={{ fill: "var(--muted)", fillOpacity: 0.35 }}
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => formatDayTick(Number(value))}
                  indicator="dot"
                />
              }
            />
            <Bar
              dataKey="downloads"
              fill="var(--color-downloads)"
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ChartContainer>
        {/*
          The table twin rule applies here too: every plotted value is
          reachable as text, so the bars enhance rather than gate.
        */}
        <table className="sr-only">
          <caption>npm downloads per UTC day</caption>
          <tbody>
            {series.points.map((point) => (
              <tr key={point.day}>
                <th scope="row">{point.day}</th>
                <td>{point.downloads}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

/**
 * The card plus its caveat. The footnote is the load-bearing part: the number
 * is npm's own counter — every tarball fetch counts (reinstalls, upgrades,
 * CI), the install.sh and GitHub-release channels never reach it, and its
 * days are UTC. Presenting it without that reading would let the chart
 * impersonate an install count.
 */
export function NpmSection({ series }: { readonly series: NpmDownloadSeries | null }) {
  if (!series) return null;

  const total = series.points.reduce((sum, point) => sum + point.downloads, 0);
  const peak = series.points.reduce(
    (best, point) => (point.downloads > best.downloads ? point : best),
    series.points[0] ?? { day: "", downloads: 0 },
  );

  return (
    <section className="flex flex-col gap-4">
      <h2 className="kunai-type-title text-xl">Install channels</h2>
      <NpmDownloads series={series} />
      <p className="text-muted-foreground m-0 text-xs text-pretty">
        {total.toLocaleString("en-US")} downloads in the window
        {peak.day ? `, peaking at ${peak.downloads} on ${peak.day}` : ""}. npm counts every tarball
        fetch — reinstalls, upgrades, and CI included — and never sees install.sh or GitHub-binary
        installs. A channel pulse, not an install count, and its days are UTC.
      </p>
    </section>
  );
}
