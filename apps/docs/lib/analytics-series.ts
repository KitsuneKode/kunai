/**
 * The published day-by-day series, as the docs site consumes it.
 *
 * Mirrors `analytics-metrics.ts`: parse defensively, return `null` rather than a
 * half-built shape, and let the page decide what to render. The ingest applies
 * small-cell suppression across the whole window before this is ever fetched —
 * nothing here re-derives privacy, it only draws what it is given.
 */

import { resolveAnalyticsMetricsUrl } from "./analytics-metrics";

/** The residual bucket. Never a real version, OS, or arch value. */
export const RESIDUAL_LABEL = "other";

/**
 * How many named version bands the adoption chart draws before folding the rest
 * into the residual.
 *
 * This is a *color* limit, not an editorial one: the ordinal ramp is validated
 * at five steps and fails the adjacent-lightness check at six, so a sixth band
 * would be indistinguishable from its neighbour. See `app/styles/charts.css`.
 */
export const MAX_VERSION_BANDS = 5;

export type SeriesPoint = {
  readonly day: string;
  readonly activeInstalls: number;
  readonly lifetimeInstalls: number;
  readonly byVersion: Readonly<Record<string, number>>;
};

export type DocsAnalyticsSeries = {
  readonly from: string;
  readonly to: string;
  readonly points: readonly SeriesPoint[];
  readonly updatedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCounts(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const counts: Record<string, number> = {};
  for (const [bucket, raw] of Object.entries(value)) {
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return null;
    counts[bucket] = Math.floor(raw);
  }
  return counts;
}

/**
 * A real calendar date, not merely the right shape.
 *
 * The format check alone accepts `2026-13-45` and `2026-00-00`, which
 * `Date.parse` returns NaN for. That NaN reaches the x-scale and every SVG path
 * on the chart becomes `MNaN,NaN` — which browsers drop silently, so the plot
 * disappears with no error anywhere.
 */
function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parsePoint(value: unknown): SeriesPoint | null {
  if (!isRecord(value)) return null;
  const { day, activeInstalls, lifetimeInstalls } = value;
  if (typeof day !== "string" || !isCalendarDay(day)) return null;
  if (typeof activeInstalls !== "number" || !Number.isFinite(activeInstalls)) return null;
  if (typeof lifetimeInstalls !== "number" || !Number.isFinite(lifetimeInstalls)) return null;
  const byVersion = parseCounts(value.byVersion);
  if (!byVersion) return null;
  return {
    day,
    activeInstalls: Math.max(0, Math.floor(activeInstalls)),
    lifetimeInstalls: Math.max(0, Math.floor(lifetimeInstalls)),
    byVersion,
  };
}

export function parseDocsAnalyticsSeries(raw: unknown): DocsAnalyticsSeries | null {
  if (!isRecord(raw)) return null;
  const { from, to, updatedAt, points } = raw;
  // The window is held to the same standard as the points inside it. It is
  // rendered as the axis labels, so a malformed bound prints as the range the
  // chart claims to cover, and a reversed pair describes a window that ran
  // backwards. Every point is already rejected on a bad day; the window that
  // frames them cannot be the one thing taken on trust.
  if (typeof from !== "string" || !isCalendarDay(from)) return null;
  if (typeof to !== "string" || !isCalendarDay(to)) return null;
  if (from > to) return null;
  if (typeof updatedAt !== "string") return null;
  if (!Array.isArray(points) || points.length === 0) return null;

  const parsed: SeriesPoint[] = [];
  for (const point of points) {
    const next = parsePoint(point);
    // One malformed day makes the whole window untrustworthy: a chart drawn from
    // a partially parsed series would quietly misstate a trend.
    if (!next) return null;
    // Strictly ascending. Both stores already order by day, but this is the
    // trust boundary for an HTTP response, and the x-scale positions points by
    // date — an out-of-order day yields a NEGATIVE offset and paints its mark
    // outside the plot, which `overflow: visible` then shows over the page.
    // A duplicate day is equally untrustworthy: the window would double-count.
    const previous = parsed.at(-1);
    if (previous && previous.day >= next.day) return null;
    parsed.push(next);
  }
  return { from, to, updatedAt, points: parsed };
}

/**
 * The version bands worth drawing, newest release last.
 *
 * Versions are *ordered*, so the bands are sorted by version rather than by
 * size — the reader's question is "is the newest one taking over", and a chart
 * sorted by magnitude destroys exactly that reading. The residual always sits
 * first so the named bands stack above it.
 */
export function versionBands(
  series: DocsAnalyticsSeries,
  limit: number = MAX_VERSION_BANDS,
): readonly string[] {
  const totals = new Map<string, number>();
  for (const point of series.points) {
    for (const [bucket, count] of Object.entries(point.byVersion)) {
      if (bucket === RESIDUAL_LABEL) continue;
      totals.set(bucket, (totals.get(bucket) ?? 0) + count);
    }
  }
  // Biggest-by-total decides *which* bands survive the color limit; version
  // order decides how they stack.
  const kept = [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || compareVersions(a[0], b[0]))
    .slice(0, limit)
    .map(([bucket]) => bucket);
  return kept.sort(compareVersions);
}

/** Numeric-aware version compare, so `0.10.0` sorts after `0.9.0`. */
export function compareVersions(left: string, right: string): number {
  const a = left.split(/[.-]/);
  const b = right.split(/[.-]/);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? "";
    const y = b[i] ?? "";
    const nx = Number.parseInt(x, 10);
    const ny = Number.parseInt(y, 10);
    if (Number.isFinite(nx) && Number.isFinite(ny) && nx !== ny) return nx - ny;
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
      const cmp = x.localeCompare(y);
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

/**
 * True when suppression has folded everything into the residual.
 *
 * With a small population this is the normal state, not a failure — the floor
 * is doing its job. The page says so rather than drawing an all-grey band and
 * letting the reader think the chart is broken.
 */
export function isFullySuppressed(series: DocsAnalyticsSeries): boolean {
  return versionBands(series).length === 0;
}

export function resolveAnalyticsSeriesUrl(): string {
  const daily = resolveAnalyticsMetricsUrl();
  if (!daily) return "";
  return daily.replace(/daily\.json$/, "series.json");
}

export async function fetchDocsAnalyticsSeries(options?: {
  readonly url?: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<DocsAnalyticsSeries | null> {
  const url = options?.url ?? resolveAnalyticsSeriesUrl();
  if (!url) return null;
  const fetchImpl = options?.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      next: { revalidate: 3600 },
    });
    if (!response.ok) return null;
    const json: unknown = await response.json();
    return parseDocsAnalyticsSeries(json);
  } catch {
    return null;
  }
}
