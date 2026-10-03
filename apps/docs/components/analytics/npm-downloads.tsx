"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { dayToEpoch, formatDayTick, median, robustAxisCap } from "@/lib/analytics-derive";
import type { NpmDownloadSeries } from "@/lib/analytics-npm";
import type { ComponentProps } from "react";
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
 *
 * The axis is cut when one day dwarfs the rest. The package launched with a
 * single day of 157 fetches against 0–10 on every day after it, and fitting the
 * axis to 157 drew the whole month as hairlines. Instead the axis stops where
 * ordinary days fill it, the launch bar runs off the top, and it is labelled
 * with its real number so the cut hides nothing. The tooltip and the table twin
 * always carry the true value.
 */

const chartConfig = {
  downloads: {
    label: "npm downloads",
    color: "var(--kunai-chart-npm)",
  },
} satisfies ChartConfig;

/** Plot-area top margin when a bar is cut: room for its real-value label. */
const CUT_TOP_MARGIN = 22;

type CutLabelProps = {
  readonly x?: number | string;
  readonly width?: number | string;
  readonly value: number;
  readonly cap: number;
};

/** The real number for a bar that runs off the top of the axis; nothing for the rest. */
function CutLabel({ x = 0, width = 0, value, cap }: CutLabelProps) {
  if (value <= cap) return null;
  return (
    <text
      x={Number(x) + Number(width) / 2}
      y={12}
      textAnchor="middle"
      fill="var(--color-fd-foreground)"
      fontSize={11}
      className="tabular-nums"
    >
      {`${value} ↑`}
    </text>
  );
}

/**
 * The `label` callback for a chart whose axis stops at `cap`. Built outside the
 * component: an inline arrow that returns JSX is a new component on every render,
 * which is what `react/no-unstable-nested-components` rejects, and a bar label is
 * redrawn on every hover.
 */
function cutLabelFor(cap: number): NonNullable<ComponentProps<typeof Bar>["label"]> {
  return ({ x, width, value }) => <CutLabel x={x} width={width} value={Number(value)} cap={cap} />;
}

export function NpmDownloads({ series }: { readonly series: NpmDownloadSeries }) {
  const { cap, clipped } = robustAxisCap(series.points.map((point) => point.downloads));
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
          className="aspect-auto h-[160px] w-full"
          initialDimension={{ width: 0, height: 160 }}
        >
          <BarChart
            data={data}
            margin={{ left: 4, right: 20, top: clipped ? CUT_TOP_MARGIN : 4 }}
            // Bars are the only tall thing here; a wider gap keeps 30 of them from
            // reading as one slab at the narrow end.
            barCategoryGap="22%"
          >
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
            {/*
              `allowDataOverflow` is what lets a value past the top of the domain
              be clipped instead of stretching the domain to fit it. The width is
              36 rather than 28 so a three-digit tick is never drawn under a bar.
            */}
            <YAxis
              domain={[0, cap]}
              allowDataOverflow
              tickLine={false}
              axisLine={false}
              width={36}
              allowDecimals={false}
              tickMargin={4}
              tickCount={3}
            />
            <ChartTooltip
              cursor={{ fill: "var(--kunai-chart-npm)", fillOpacity: 0.12 }}
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
              label={clipped ? cutLabelFor(cap) : false}
            />
          </BarChart>
        </ChartContainer>
        {clipped ? (
          <p className="text-muted-foreground m-0 mt-1 px-2 text-xs text-pretty sm:px-0">
            The axis stops at {cap} so ordinary days stay readable. The bar that runs off the top is
            labelled with its real value.
          </p>
        ) : null}
        {/*
          The table twin rule applies here too: every plotted value is
          reachable as text, so the bars enhance rather than gate.
        */}
        {/*
          The visually-hidden class sits on a wrapper, not on the table. A table
          ignores `width: 1px` and keeps its content width, so `<table class="sr-only">`
          stayed 320px wide, extended past a 320px phone viewport, and gave the page a
          horizontal scroll. A block wrapper honours the 1px clip.
        */}
        <div className="sr-only">
          <table>
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
        </div>
      </CardContent>
    </Card>
  );
}

/** One figure in the stats row: a small label over a tabular number. */
function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-foreground m-0 text-xl font-medium tabular-nums">{value}</dd>
      {note ? <dd className="text-muted-foreground m-0 text-xs">{note}</dd> : null}
    </div>
  );
}

/**
 * The card plus its numbers and its caveat. The caveat is the load-bearing part:
 * the number is npm's own counter — every tarball fetch counts (reinstalls,
 * upgrades, CI), the install.sh and GitHub-release channels never reach it, and
 * its days are UTC. Presenting it without that reading would let the chart
 * impersonate an install count.
 *
 * The three figures answer different questions: the total is the size of the
 * channel, the typical day (a median, so one launch day cannot move it) is how
 * it behaves, and the peak is the one outlier worth naming.
 */
export function NpmSection({ series }: { readonly series: NpmDownloadSeries | null }) {
  if (!series) return null;

  const total = series.points.reduce((sum, point) => sum + point.downloads, 0);
  const typical = median(series.points.map((point) => point.downloads));
  const peak = series.points.reduce(
    (best, point) => (point.downloads > best.downloads ? point : best),
    series.points[0] ?? { day: "", downloads: 0 },
  );

  return (
    <section className="flex flex-col gap-4">
      <h2 className="kunai-type-title text-xl">Install channels</h2>
      <dl className="m-0 flex flex-wrap gap-x-10 gap-y-3">
        <Stat
          label={`Downloads, ${series.points.length} days`}
          value={total.toLocaleString("en-US")}
        />
        <Stat label="Typical day" value={String(typical)} note="median" />
        <Stat
          label="Busiest day"
          value={peak.downloads.toLocaleString("en-US")}
          note={peak.day || undefined}
        />
      </dl>
      <NpmDownloads series={series} />
      <p className="text-muted-foreground m-0 text-xs text-pretty">
        npm counts every tarball fetch — reinstalls, upgrades, and CI included — and never sees
        install.sh or GitHub-binary installs. A channel pulse, not an install count, and its days
        are UTC.
      </p>
    </section>
  );
}
