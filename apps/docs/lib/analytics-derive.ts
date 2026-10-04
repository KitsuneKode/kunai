/**
 * Everything the dashboard reads that is not in the payload.
 *
 * The published rollup is deliberately dumb — counts per day, nothing derived.
 * Deltas, window ranges and suppression share are presentation concerns, so
 * they live here as pure functions rather than in a component: the KPI row, the
 * chart header and the breakdown cards all need the same numbers, and a
 * second implementation is how two surfaces start disagreeing about the same
 * install count.
 *
 * Nothing here re-derives privacy. Suppression already happened at the ingest;
 * `residualShare` only *reports* how much of a breakdown it ate.
 */

import { RESIDUAL_LABEL, type SeriesPoint } from "./analytics-series";

/** How a figure moved. `flat` is a real answer, not a missing one. */
export type TrendDirection = "up" | "down" | "flat";

export type Delta = {
  readonly value: number;
  readonly direction: TrendDirection;
  /** Pre-signed for display: `+2`, `-1`, `0`. */
  readonly label: string;
};

export function delta(current: number, previous: number): Delta {
  const value = current - previous;
  const direction: TrendDirection = value > 0 ? "up" : value < 0 ? "down" : "flat";
  return {
    value,
    direction,
    label: value > 0 ? `+${value}` : String(value),
  };
}

export type RangeKey = "7d" | "30d" | "all";

export type RangeOption = {
  readonly key: RangeKey;
  readonly label: string;
  /** Header copy under ~540px, where the full label wraps. */
  readonly shortLabel: string;
};

const RANGE_DAYS: Readonly<Record<Exclude<RangeKey, "all">, number>> = {
  "7d": 7,
  "30d": 30,
};

/**
 * Narrow a control's string back to a `RangeKey`. Select and ToggleGroup hand
 * values back as plain strings, so the boundary re-validates rather than
 * asserts — a string that is not a key is a no-op, not a stored lie.
 */
export function isRangeKey(value: string | null | undefined): value is RangeKey {
  return value === "7d" || value === "30d" || value === "all";
}

/**
 * The ranges worth offering for a given window.
 *
 * A range only earns a button if it actually *cuts* the data. dashboard-01 can
 * hardcode 3 months / 30 days / 7 days because its fixture always spans 90
 * days; a real window of 9 days would render "Last 30 days" and "All time" as
 * two buttons showing an identical chart, which teaches the reader the control
 * is broken. Below eight days nothing subsets, so the caller drops the toggle
 * entirely rather than render a single dead option.
 */
export function availableRanges(points: readonly SeriesPoint[]): readonly RangeOption[] {
  const span = points.length;
  const options: RangeOption[] = [];
  for (const key of ["7d", "30d"] as const) {
    if (span > RANGE_DAYS[key]) {
      options.push({
        key,
        label: `Last ${RANGE_DAYS[key]} days`,
        shortLabel: `${RANGE_DAYS[key]}d`,
      });
    }
  }
  if (options.length > 0) {
    options.push({ key: "all", label: `All ${span} days`, shortLabel: "All" });
  }
  return options;
}

/** The tail of the window a range selects. `all` is the identity slice. */
export function sliceRange(
  points: readonly SeriesPoint[],
  range: RangeKey,
): readonly SeriesPoint[] {
  if (range === "all") return points;
  const days = RANGE_DAYS[range];
  return points.length <= days ? points : points.slice(points.length - days);
}

/**
 * How much of a breakdown the five-install floor folded into `other`.
 *
 * Returns 1 when every bucket is residual — the normal state for a small
 * population, and the thing the page should *say* rather than draw as one grey
 * bar. Returns 0 for an empty breakdown: nothing was collected, so nothing was
 * suppressed, and claiming 100% suppression there would be a lie.
 */
export function residualShare(counts: Readonly<Record<string, number>>): number {
  let total = 0;
  let residual = 0;
  for (const [bucket, count] of Object.entries(counts)) {
    total += count;
    if (bucket === RESIDUAL_LABEL) residual += count;
  }
  return total === 0 ? 0 : residual / total;
}

/**
 * Epoch milliseconds for a rollup day, for a time-scaled x-axis.
 *
 * The axis MUST be positioned by date, not by array index. `readRollups`
 * returns only the days that actually have a rollup, so a missed cron run
 * leaves a hole — and a category axis (recharts' default for a string
 * `dataKey`) spaces every row equally, drawing a one-day gap and an eleven-day
 * gap at the same width. The line would misstate time.
 *
 * Parsed as UTC: the keys are calendar days, and a local-midnight parse shifts
 * every point a day west of Greenwich.
 */
export function dayToEpoch(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

/**
 * An axis tick label for an epoch-millisecond x value.
 *
 * Formatted in UTC to match `dayToEpoch`: the rollup keys are calendar days, so
 * a local-timezone label shifts every tick a day west of Greenwich.
 */
export function formatDayTick(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Distinct named (non-residual) buckets seen anywhere in the window. */
export function namedVersionCount(points: readonly SeriesPoint[]): number {
  const seen = new Set<string>();
  for (const point of points) {
    for (const [bucket, count] of Object.entries(point.byVersion)) {
      if (bucket !== RESIDUAL_LABEL && count > 0) seen.add(bucket);
    }
  }
  return seen.size;
}

/**
 * Display names for the closed `os` keyspace. `darwin`/`win32` are platform
 * identifiers, not names a reader should have to decode. Anything outside the
 * known set passes through unchanged — the same call is safe on version and
 * arch buckets, whose labels are already the right display form.
 */
export function platformLabel(key: string): string {
  switch (key) {
    case "linux":
      return "Linux";
    case "darwin":
      return "macOS";
    case "win32":
      return "Windows";
    case RESIDUAL_LABEL:
      return "Other";
    default:
      return key;
  }
}

/**
 * The platform buckets the window actually published, in canonical order with
 * the residual last. A bucket absent from every point earns no column — the
 * table should not promise a series that is empty end to end. Returns [] when
 * `byOs` is empty across the window (an unpublishable or pre-field series).
 */
export function platformColumns(points: readonly SeriesPoint[]): readonly string[] {
  const seen = new Set<string>();
  for (const point of points) {
    // A key that only ever appears at 0 is an empty promise of a series —
    // same rule `namedVersionCount` uses for the version dimension.
    for (const [bucket, count] of Object.entries(point.byOs)) {
      if (count > 0) seen.add(bucket);
    }
  }
  const named = ["linux", "darwin", "win32"].filter((key) => seen.delete(key));
  // `seen.delete` above removes the named keys as it collects them; whatever
  // remains beyond the residual is an unexpected key and sorts before it.
  const unexpected = [...seen].filter((key) => key !== RESIDUAL_LABEL).sort();
  const columns = [...named, ...unexpected];
  if (seen.has(RESIDUAL_LABEL)) columns.push(RESIDUAL_LABEL);
  return columns;
}
