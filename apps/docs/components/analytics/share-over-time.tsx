"use client";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { dayToEpoch, formatDayTick } from "@/lib/analytics-derive";
import {
  isFullySuppressed,
  MAX_VERSION_BANDS,
  RESIDUAL_LABEL,
  shareBands,
  type DocsAnalyticsSeries,
  type ShareDimension,
} from "@/lib/analytics-series";
import { IconStack2 } from "@tabler/icons-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

/**
 * Share of active installs over time, for one breakdown.
 *
 * A genuine stack, unlike the installs chart: the bands are shares of one day
 * and sum to 100%, so stacking states something true. Share, not counts — the
 * question is what fraction has moved, and a count chart answers "how many
 * installs" instead.
 *
 * The ramp is ordinal, which fits versions exactly: released order reads out of
 * the colour rather than only the legend. Platform and architecture are
 * nominal, so for them the ramp carries rank, not sequence — the legend is the
 * identity channel there, which is why it is always rendered.
 *
 * `MAX_VERSION_BANDS` is a colour limit, not an editorial one: the ramp is
 * validated at five steps and fails the adjacent-lightness check at six.
 */

/** What one band *is*, for copy that has to name it in a sentence. */
export const DIMENSION_NOUN: Readonly<Record<ShareDimension, string>> = {
  byVersion: "version",
  byOs: "platform",
  byArch: "architecture",
};

const BAND_COLOR = (index: number): string =>
  `var(--kunai-chart-band-${Math.min(index + 1, MAX_VERSION_BANDS)})`;

/**
 * A CSS-safe series key for a version string.
 *
 * `ChartStyle` emits one `--color-<key>` custom property per config key, and a
 * custom property name is a CSS identifier: `--color-0.3.0` is invalid, so the
 * whole declaration is dropped and every band silently renders unpainted. The
 * real version travels in `label`, which is what the legend and tooltip show.
 */
export const seriesKey = (bucket: string): string => `v${bucket.replace(/[^a-zA-Z0-9]/g, "_")}`;

/**
 * Renders one tooltip row as a percentage.
 *
 * Module scope, not an inline arrow: defined inside `VersionAdoption` it is a
 * fresh function identity on every render, so recharts remounts the tooltip
 * subtree each time the pointer moves a pixel.
 */
const formatSharePercent = (value: unknown, name: unknown) => (
  <>
    <span className="text-muted-foreground">{String(name)}</span>
    <span className="text-foreground ml-auto font-mono font-medium tabular-nums">
      {Math.round(Number(value) * 100)}%
    </span>
  </>
);

export function ShareOverTime({
  series,
  dimension,
}: {
  readonly series: DocsAnalyticsSeries;
  readonly dimension: ShareDimension;
}) {
  const bands = shareBands(series, dimension);

  /*
   * With a small population every bucket sits under the five-install floor and
   * the whole chart is residual. That is suppression working, not a broken
   * chart — so it says so, instead of drawing one flat grey band that reads as
   * a rendering bug.
   */
  if (isFullySuppressed(series, dimension)) {
    return (
      <Empty className="border-border/70 bg-muted/10 my-2 max-w-md flex-none self-center rounded-lg border border-dashed px-4 py-6">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconStack2 />
          </EmptyMedia>
          <EmptyTitle>Every {DIMENSION_NOUN[dimension]} is below the floor</EmptyTitle>
          <EmptyDescription className="max-w-md text-pretty">
            No single {DIMENSION_NOUN[dimension]} has five installs reporting yet, so the whole
            window folds into <span className="text-foreground font-medium">other</span>. This chart
            appears once one is running on enough machines to publish without identifying anyone.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  // Bottom-up: residual first, then oldest to newest.
  const stackOrder = [RESIDUAL_LABEL, ...bands];

  const chartConfig: ChartConfig = Object.fromEntries(
    stackOrder.map((bucket, index) => [
      seriesKey(bucket),
      {
        label: bucket,
        color: bucket === RESIDUAL_LABEL ? "var(--kunai-chart-residual)" : BAND_COLOR(index - 1),
      },
    ]),
  );

  const data = series.points.map((point) => {
    const counts = point[dimension];
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    const named = bands.reduce((sum, b) => sum + (counts[b] ?? 0), 0);
    const row: Record<string, number> = { t: dayToEpoch(point.day) };
    if (total > 0) {
      row[seriesKey(RESIDUAL_LABEL)] = Math.max(0, total - named) / total;
      for (const band of bands) row[seriesKey(band)] = (counts[band] ?? 0) / total;
    } else {
      // A day with no pings is a real hole, not a 100% residual day.
      row[seriesKey(RESIDUAL_LABEL)] = 0;
      for (const band of bands) row[seriesKey(band)] = 0;
    }
    return row;
  });

  return (
    <ChartContainer
      config={chartConfig}
      className="aspect-auto h-[220px] w-full"
      initialDimension={{ width: 0, height: 220 }}
    >
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 4 }}>
        <CartesianGrid vertical={false} />
        {/* Time scale for the same reason as the installs chart: a skipped
            rollup day must draw a proportional gap, not an equal one. */}
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={formatDayTick}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={36}
          domain={[0, 1]}
          tickFormatter={(value: number) => `${Math.round(value * 100)}%`}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(value) => formatDayTick(Number(value))}
              formatter={formatSharePercent}
            />
          }
        />
        {stackOrder.map((bucket) => (
          <Area
            key={bucket}
            dataKey={seriesKey(bucket)}
            // `dataKey` is the CSS-safe key, so without an explicit `name`
            // recharts labels the tooltip row "v0_3_0" instead of "0.3.0".
            name={bucket}
            type="monotone"
            stackId="version"
            fill={`var(--color-${seriesKey(bucket)})`}
            fillOpacity={0.85}
            stroke="var(--kunai-chart-surface)"
            strokeWidth={2}
            isAnimationActive={false}
          />
        ))}
        <ChartLegend content={<ChartLegendContent />} />
      </AreaChart>
    </ChartContainer>
  );
}
