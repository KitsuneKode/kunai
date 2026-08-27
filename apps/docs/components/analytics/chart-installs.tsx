"use client";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { availableRanges, dayToEpoch, sliceRange, type RangeKey } from "@/lib/analytics-derive";
import type { SeriesPoint } from "@/lib/analytics-series";
import * as React from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

/**
 * Installs over time — the page's one interactive chart.
 *
 * Two series, NOT stacked. `active` is a strict subset of `lifetime` (an
 * install that pinged yesterday has by definition been seen before), so the
 * areas nest: lifetime is the outer envelope, active the region inside it.
 * Stacking would draw `lifetime + active` and overstate the population by the
 * active count on every single day.
 *
 * Lifetime is here at all because it is the only series with shape. Active
 * oscillates 0–2 at this population; a chart of it alone is a flat zigzag that
 * tells the reader nothing. Lifetime carries the growth story and gives the
 * active band something to sit inside.
 *
 * Both are counts of installs in the same unit, so they share one axis. This is
 * the one case where two series on one scale is honest — a second y-axis here
 * would invent a relationship that the nesting already states truthfully.
 */

const chartConfig = {
  lifetimeInstalls: {
    label: "Lifetime",
    color: "var(--kunai-chart-lifetime)",
  },
  activeInstalls: {
    label: "Active that day",
    color: "var(--kunai-chart-active)",
  },
} satisfies ChartConfig;

function formatTick(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function ChartInstalls({
  points,
  from,
  to,
}: {
  readonly points: readonly SeriesPoint[];
  readonly from: string;
  readonly to: string;
}) {
  const ranges = availableRanges(points);
  const [range, setRange] = React.useState<RangeKey>("all");

  const visible = sliceRange(points, range);
  const data = visible.map((point) => ({
    t: dayToEpoch(point.day),
    activeInstalls: point.activeInstalls,
    lifetimeInstalls: point.lifetimeInstalls,
  }));

  const spanLabel =
    range === "all"
      ? `${from} → ${to}`
      : `${visible[0]?.day ?? from} → ${visible.at(-1)?.day ?? to}`;

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Installs over time</CardTitle>
        <CardDescription>
          <span className="hidden @[540px]/card:block">
            Daily active installs inside the lifetime total · {spanLabel}
          </span>
          <span className="@[540px]/card:hidden">{spanLabel}</span>
        </CardDescription>
        {/*
          The toggle is absent, not disabled, when no range would cut the
          window — a control that cannot change what you see is worse than no
          control. `availableRanges` returns [] below eight days.
        */}
        {ranges.length > 0 ? (
          <CardAction>
            <ToggleGroup
              value={[range]}
              onValueChange={(next: string[]) => {
                const picked = next[0];
                if (picked) setRange(picked as RangeKey);
              }}
              variant="outline"
              size="sm"
              spacing={0}
              className="hidden @[600px]/card:flex"
            >
              {ranges.map((option) => (
                <ToggleGroupItem key={option.key} value={option.key} className="px-3">
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Select
              value={range}
              onValueChange={(next: string | null) => {
                if (next) setRange(next as RangeKey);
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-36 @[600px]/card:hidden"
                aria-label="Time range"
              >
                <SelectValue>
                  {(value: string) => ranges.find((o) => o.key === value)?.label ?? value}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {ranges.map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[260px] w-full">
          <AreaChart data={data} margin={{ left: 4, right: 20, top: 4 }}>
            <defs>
              <linearGradient id="kunai-fill-lifetime" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-lifetimeInstalls)" stopOpacity={0.7} />
                <stop offset="95%" stopColor="var(--color-lifetimeInstalls)" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="kunai-fill-active" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-activeInstalls)" stopOpacity={0.9} />
                <stop offset="95%" stopColor="var(--color-activeInstalls)" stopOpacity={0.12} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            {/*
              A TIME scale, not the default category scale. The rollup skips
              days the cron missed, and a category axis spaces every row
              equally — so a one-day gap and an eleven-day gap would be drawn
              the same width and the line would misstate time.
            */}
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
              tickFormatter={formatTick}
            />
            {/*
              dashboard-01 omits the y-axis because its values are in the
              hundreds and the tooltip carries the rest. At counts of 0–7 an
              unlabelled axis makes the chart unreadable in absolute terms, and
              recharts will happily tick 0.5 installs — hence `allowDecimals`.
            */}
            <YAxis
              tickLine={false}
              axisLine={false}
              width={28}
              allowDecimals={false}
              tickMargin={4}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => formatTick(Number(value))}
                  indicator="dot"
                />
              }
            />
            {/*
              Animation is off deliberately, and it is not a style preference:
              recharts reveals an area by growing a clip rect from width 0, so
              a mount animation that never advances leaves the rect AT zero and
              the chart renders blank over a perfectly good set of paths. It
              also replays on every range toggle, which is the one interaction
              here frequent enough for motion to become friction — and it buys
              nothing, since there is no state change to explain.

              Painted back to front, and `monotone` rather than dashboard-01's
              `natural`: a cardinal spline overshoots between points, so a run
              of 2 → 0 → 0 dips the curve BELOW zero and draws a negative
              install count. Monotone cannot overshoot.
            */}
            <Area
              dataKey="lifetimeInstalls"
              type="monotone"
              fill="url(#kunai-fill-lifetime)"
              stroke="var(--color-lifetimeInstalls)"
              strokeWidth={2}
              isAnimationActive={false}
            />
            <Area
              dataKey="activeInstalls"
              type="monotone"
              fill="url(#kunai-fill-active)"
              stroke="var(--color-activeInstalls)"
              strokeWidth={2}
              isAnimationActive={false}
            />
            {/* Two series: identity is never colour alone, so the legend is not optional. */}
            <ChartLegend content={<ChartLegendContent />} />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
