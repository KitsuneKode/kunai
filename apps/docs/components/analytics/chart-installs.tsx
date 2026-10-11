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
import {
  availableRanges,
  CLOCK_SEAM_HOURS,
  clockSeamIn,
  dayToEpoch,
  formatDayTick,
  isRangeKey,
  platformColumns,
  platformLabel,
  type ReleaseMarker,
  rollingMean,
  sliceRange,
  type RangeKey,
} from "@/lib/analytics-derive";
import type { SeriesPoint } from "@/lib/analytics-series";
import * as React from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";

/**
 * Installs over time — the page's one interactive chart.
 *
 * A metric toggle picks the view; within a view, series that nest are drawn
 * nested and stacking appears only where the parts genuinely sum to the whole:
 *
 * - **Per day** draws `active` (installs that pinged that day) as the envelope
 *   and `new` (installs first seen that day) inside it. `new` is a strict
 *   subset of `active` — a first-seen install pinged that day by definition —
 *   so the nesting is structural, not a visual coincidence.
 * - **Platforms** draws the per-day OS buckets as a STACK — the one place
 *   stacking is honest here. Suppression folds small buckets into `other`
 *   rather than dropping them, so the stack always sums to `active`: a true
 *   partition of the day's installs, not independent series glued together.
 * - **Total** draws `lifetime` alone: installs ever observed, a cumulative
 *   count. Retention moves a silent install out of the live table but into
 *   the retired counter, which the total includes, so it only ever grows.
 *
 * Stacking `active + new` would draw `a + b` and overstate the population on
 * every single day — the views keep the nested pair and the partition on
 * separate tabs so neither can masquerade as the other. One shared axis is
 * deliberate — a second y-axis would invent a relationship the views already
 * state truthfully.
 */

type MetricKey = "day" | "platforms" | "total";

const METRICS: readonly { readonly key: MetricKey; readonly label: string }[] = [
  { key: "day", label: "Per day" },
  { key: "platforms", label: "Platforms" },
  { key: "total", label: "Total" },
];

/** The controls emit strings; a key is only accepted if it names a real view. */
function isMetricKey(value: string | null | undefined): value is MetricKey {
  return METRICS.some((option) => option.key === value);
}

/** CSS token for a platform series; unexpected buckets fall back to `extra`. */
function platformToken(key: string): string {
  switch (key) {
    case "linux":
      return "var(--kunai-chart-os-linux)";
    case "darwin":
      return "var(--kunai-chart-os-macos)";
    case "win32":
      return "var(--kunai-chart-os-windows)";
    case "other":
      return "var(--kunai-chart-os-other)";
    default:
      return "var(--kunai-chart-os-extra)";
  }
}

const chartConfig = {
  lifetimeInstalls: {
    label: "Lifetime",
    color: "var(--kunai-chart-lifetime)",
  },
  activeInstalls: {
    label: "Active that day",
    color: "var(--kunai-chart-active)",
  },
  newInstalls: {
    label: "First seen that day",
    color: "var(--kunai-chart-new)",
  },
  activeAverage: {
    label: "7-day average",
    color: "var(--kunai-chart-avg)",
  },
} satisfies ChartConfig;

/** A stable empty default: a fresh `[]` per render would defeat memoisation downstream. */
const NO_RELEASES: readonly ReleaseMarker[] = [];

/** Trailing days the smoothed active line averages over. */
const AVERAGE_WINDOW_DAYS = 7;

function roundTenth(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

function ChartInstallsView({
  points,
  from,
  to,
  releases = NO_RELEASES,
  onDayHover,
}: {
  readonly points: readonly SeriesPoint[];
  readonly from: string;
  readonly to: string;
  /**
   * Release days inside the series window, drawn as labelled guides so a step
   * in the line can be read against what shipped. Filtered again to the drawn
   * range here, because the range toggle moves the left edge.
   */
  readonly releases?: readonly ReleaseMarker[];
  /**
   * Optional chart → table sync. Called with the hovered rollup day, or null
   * when the pointer leaves. Only the *drawn* range is reported — days the
   * range toggle cut are not on the axis, so they cannot be hovered.
   */
  readonly onDayHover?: (day: string | null) => void;
}) {
  const ranges = availableRanges(points);
  const [range, setRange] = React.useState<RangeKey>("all");
  const [metric, setMetric] = React.useState<MetricKey>("day");

  // Platform buckets the window published at all — an empty byOs earns no tab.
  const osKeys = React.useMemo(() => platformColumns(points), [points]);
  const effectiveMetric: MetricKey = metric === "platforms" && osKeys.length === 0 ? "day" : metric;
  const metricOptions =
    osKeys.length === 0 ? METRICS.filter((m) => m.key !== "platforms") : METRICS;

  const visible = sliceRange(points, range);
  // The average is computed over the FULL series and then sliced, so a "last 7
  // days" view still averages across the days before its left edge instead of
  // restarting from a one-point mean.
  const averageByDay = React.useMemo(() => {
    const averages = rollingMean(
      points.map((point) => point.activeInstalls),
      AVERAGE_WINDOW_DAYS,
    );
    return new Map(points.map((point, index) => [point.day, averages[index] ?? null]));
  }, [points]);
  const firstVisible = visible[0]?.day;
  const lastVisible = visible.at(-1)?.day;
  const markers = releases.filter(
    (marker) =>
      firstVisible !== undefined &&
      lastVisible !== undefined &&
      marker.day >= firstVisible &&
      marker.day <= lastVisible,
  );
  // The day the labels changed from UTC to IST covers 18.5 hours, so it reads low.
  // Marked on the chart and named under it, because an unexplained dip invites the
  // wrong conclusion about the release that happened to land near it.
  const seam = clockSeamIn(visible.map((point) => point.day));
  // `null`, not 0, where the wire did not publish the field — recharts treats
  // null as a gap, while 0 would draw a false floor under every old point.
  const hasNew = visible.some((point) => point.newInstalls !== null);
  const data = visible.map((point) => ({
    t: dayToEpoch(point.day),
    activeInstalls: point.activeInstalls,
    newInstalls: point.newInstalls,
    lifetimeInstalls: point.lifetimeInstalls,
    // One decimal: the tooltip prints this raw, and 5.428571 is false precision
    // for a count of installs.
    activeAverage: roundTenth(averageByDay.get(point.day) ?? null),
    // A missing platform key means "below the naming floor or zero" — the
    // suppressed mass lives in `other`, so zero here keeps the stack summing
    // to the day's true total instead of tearing it open.
    ...Object.fromEntries(osKeys.map((key) => [`os_${key}`, point.byOs[key] ?? 0])),
  }));

  // The fixed config names the install series; the platform series are added
  // dynamically so the legend/tooltip carry readable OS names and their own
  // categorical colours.
  const config: ChartConfig = React.useMemo(
    () => ({
      ...chartConfig,
      ...Object.fromEntries(
        osKeys.map((key) => [
          `os_${key}`,
          { label: platformLabel(key), color: platformToken(key) },
        ]),
      ),
    }),
    [osKeys],
  );

  // The axis reports `activeLabel` as the plotted epoch `t`; this inverts
  // `dayToEpoch` for the drawn range so the caller gets the rollup day back.
  const dayByEpoch = React.useMemo(
    () => new Map(visible.map((point) => [dayToEpoch(point.day), point.day])),
    [visible],
  );

  const reportHover = React.useCallback(
    // Recharts hands `activeLabel` back as `string | number`; the plotted axis
    // value is always the epoch, so anything that is not a finite number is a
    // no-op rather than a lookup miss.
    (label: number | string | undefined) => {
      // SAFETY: `Number.isFinite` verified a real number here; the union-member check does not narrow for `.get`.
      const epoch = Number.isFinite(label) ? (label as number) : null;
      onDayHover?.(epoch === null ? null : (dayByEpoch.get(epoch) ?? null));
    },
    [dayByEpoch, onDayHover],
  );

  const spanLabel =
    range === "all"
      ? `${from} → ${to}`
      : `${visible[0]?.day ?? from} → ${visible.at(-1)?.day ?? to}`;

  return (
    <Card className="@container/card">
      {/*
        `flex flex-col` below 440px, grid above. CardHeader always puts a
        CardAction in a second column, which at phone widths leaves the title
        ~150px and wraps "Installs over / time" beside the control. Switching
        the header to flex makes CardAction's grid placement inert, so the
        control simply stacks under the description.
      */}
      <CardHeader className="flex flex-col gap-2 @[440px]/card:grid">
        <CardTitle>Installs over time</CardTitle>
        <CardDescription>
          <span className="hidden @[540px]/card:block">
            {effectiveMetric === "day"
              ? "Installs active and first seen each day"
              : effectiveMetric === "platforms"
                ? "Active installs by platform — parts of each day's total"
                : "Installs ever observed, cumulative"}{" "}
            · {spanLabel}
          </span>
          <span className="@[540px]/card:hidden">{spanLabel}</span>
        </CardDescription>
        <CardAction className="flex flex-wrap items-center gap-2">
          {/*
            Which metric the card draws. Unlike the range toggle below, this
            stays visible at every width — switching views is the point of the
            card, not an optional refinement.
          */}
          <ToggleGroup
            value={[effectiveMetric]}
            onValueChange={(next: string[]) => {
              const picked = next[0];
              if (isMetricKey(picked)) setMetric(picked);
            }}
            variant="outline"
            size="sm"
            spacing={0}
            className="hidden @[600px]/card:flex"
            aria-label="Metric"
          >
            {metricOptions.map((option) => (
              <ToggleGroupItem key={option.key} value={option.key} className="px-3">
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Select
            value={effectiveMetric}
            onValueChange={(next: string | null) => {
              if (isMetricKey(next)) setMetric(next);
            }}
          >
            <SelectTrigger size="sm" className="w-32 @[600px]/card:hidden" aria-label="Metric">
              <SelectValue>
                {(value: string) => metricOptions.find((o) => o.key === value)?.label ?? value}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {metricOptions.map((option) => (
                  <SelectItem key={option.key} value={option.key}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {/*
            The range toggle is absent, not disabled, when no range would cut
            the window — a control that cannot change what you see is worse
            than no control. `availableRanges` returns [] below eight days.
          */}
          {ranges.length > 0 ? (
            <>
              <ToggleGroup
                value={[range]}
                onValueChange={(next: string[]) => {
                  const picked = next[0];
                  if (isRangeKey(picked)) setRange(picked);
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
                  if (isRangeKey(next)) setRange(next);
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
            </>
          ) : null}
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6">
        {/*
          `initialDimension` width 0, not shadcn's default 320. ResponsiveContainer
          paints at the initial width until its observer measures the real one, so
          the default bursts a 320px-wide chart out of a ~250px card on every
          phone-width first paint. Zero renders nothing for that one frame and
          then paints correctly, which is the better of the two flashes.
        */}
        <ChartContainer
          config={config}
          className="aspect-auto h-[260px] w-full"
          initialDimension={{ width: 0, height: 260 }}
        >
          {/*
            Recharts 3 hands these handlers a state object carrying
            `activeLabel` — the x value under the pointer (our epoch `t`).
            `onClick` rides the same extraction so a tap on touch devices,
            which have no hover, pins the day in the table the same way.
          */}
          <AreaChart
            data={data}
            margin={{ left: 4, right: 20, top: markers.length > 0 || seam ? 20 : 4 }}
            onMouseMove={(state) => reportHover(state?.activeLabel)}
            onMouseLeave={() => onDayHover?.(null)}
            onClick={(state) => reportHover(state?.activeLabel)}
          >
            <defs>
              <linearGradient id="kunai-fill-lifetime" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-lifetimeInstalls)" stopOpacity={0.7} />
                <stop offset="95%" stopColor="var(--color-lifetimeInstalls)" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="kunai-fill-active" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-activeInstalls)" stopOpacity={0.9} />
                <stop offset="95%" stopColor="var(--color-activeInstalls)" stopOpacity={0.12} />
              </linearGradient>
              <linearGradient id="kunai-fill-new" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-newInstalls)" stopOpacity={0.95} />
                <stop offset="95%" stopColor="var(--color-newInstalls)" stopOpacity={0.2} />
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
              tickFormatter={formatDayTick}
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
            {/*
              A crosshair, unlike dashboard-01's `cursor={false}`: with two
              nested areas the reader needs to see which date both values are
              being read at.
            */}
            <ChartTooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => formatDayTick(Number(value))}
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
            {markers.map((marker) => (
              <ReferenceLine
                key={marker.day}
                x={dayToEpoch(marker.day)}
                stroke="var(--kunai-chart-marker)"
                strokeDasharray="2 4"
                ifOverflow="visible"
                label={{
                  value: marker.tag,
                  position: "top",
                  fill: "var(--kunai-chart-marker)",
                  fontSize: 12,
                }}
              />
            ))}
            {seam ? (
              <ReferenceLine
                x={dayToEpoch(seam)}
                stroke="var(--kunai-chart-marker)"
                strokeDasharray="1 3"
                ifOverflow="visible"
                label={{
                  value: "IST",
                  position: "top",
                  fill: "var(--kunai-chart-marker)",
                  fontSize: 12,
                }}
              />
            ) : null}
            {effectiveMetric === "total" ? (
              <Area
                dataKey="lifetimeInstalls"
                type="monotone"
                fill="url(#kunai-fill-lifetime)"
                stroke="var(--color-lifetimeInstalls)"
                strokeWidth={2}
                isAnimationActive={false}
              />
            ) : effectiveMetric === "platforms" ? (
              /*
                A partition, not independent series: suppression folds small
                buckets into `other` without dropping them, so the stacked
                bands sum to exactly `active` each day. Flat translucent fills
                rather than gradients — stacked bands need flat colour to keep
                the boundaries legible where one band ends and the next begins.
              */
              osKeys.map((key) => (
                <Area
                  key={key}
                  dataKey={`os_${key}`}
                  type="monotone"
                  stackId="platform"
                  fill={`var(--color-os_${key})`}
                  fillOpacity={0.55}
                  stroke={`var(--color-os_${key})`}
                  strokeWidth={1}
                  isAnimationActive={false}
                />
              ))
            ) : (
              <>
                {/*
                  Painted back to front: `active` is the envelope, `new` the
                  subset inside it. connectNulls stays off — a day the wire did
                  not carry the field for is a gap, not a zero.
                */}
                <Area
                  dataKey="activeInstalls"
                  type="monotone"
                  fill="url(#kunai-fill-active)"
                  stroke="var(--color-activeInstalls)"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
                {visible.length >= AVERAGE_WINDOW_DAYS ? (
                  <Area
                    dataKey="activeAverage"
                    type="monotone"
                    fill="none"
                    stroke="var(--color-activeAverage)"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    isAnimationActive={false}
                    activeDot={false}
                  />
                ) : null}
                {hasNew ? (
                  <Area
                    dataKey="newInstalls"
                    type="monotone"
                    fill="url(#kunai-fill-new)"
                    stroke="var(--color-newInstalls)"
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                ) : null}
              </>
            )}
            {/* Identity is never colour alone, so the legend is not optional. */}
            <ChartLegend content={<ChartLegendContent />} />
          </AreaChart>
        </ChartContainer>
        {seam ? (
          <p className="text-muted-foreground m-0 mt-2 px-2 text-xs text-pretty sm:px-0">
            Day labels switch from UTC to IST at the dotted line, so{" "}
            {formatDayTick(dayToEpoch(seam))} covers {CLOCK_SEAM_HOURS} hours and reads low. Nothing
            was lost.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Memoised on purpose. The parent holds the hovered day and re-renders on every
 * day boundary the pointer crosses; without this the whole recharts tree
 * re-rendered with it, in the middle of the gesture that caused it. Every prop is
 * stable (server-built arrays and a `setState` callback), so the memo holds.
 */
export const ChartInstalls = React.memo(ChartInstallsView);
