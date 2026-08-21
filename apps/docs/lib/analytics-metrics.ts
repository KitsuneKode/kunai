/**
 * Quiet public usage analytics metrics for the docs home.
 * Fetches aggregates only — never Redis, never install ids.
 */

/**
 * Where the docs read the public pulse from.
 *
 * This defaults to the deployed ingest for the same reason the CLI ships a
 * default ping endpoint: an empty default is not neutral, it is a blank page.
 * The rollup is public, read-only, aggregate-only and needs no credential, so
 * there is nothing to withhold by leaving this unset — and leaving it unset is
 * exactly what shipped `/analytics` as a permanently empty "not published yet"
 * despite the ingest answering 200 with real data the whole time.
 *
 * Same immutability argument as the ping endpoint: this must stay on a domain
 * Kunai controls, never a hosting provider's own URL.
 *
 * `KUNAI_ANALYTICS_METRICS_URL` still overrides it, and must be present **at
 * build time**, not only at runtime: `/analytics` is statically prerendered, so
 * the deployed HTML is whatever the build could fetch. A runtime-only variable
 * leaves the previous build's content up until the next ISR revalidation (1h)
 * or redeploy.
 */
export const DEFAULT_ANALYTICS_METRICS_URL =
  "https://analytics.kunai.kitsunekode.in/metrics/daily.json";

export type DocsAnalyticsMetrics = {
  readonly schemaVersion: 2;
  readonly day: string;
  readonly activeInstalls: number;
  readonly lifetimeInstalls: number;
  readonly byVersion: Readonly<Record<string, number>>;
  readonly byOs: Readonly<Record<string, number>>;
  readonly byArch: Readonly<Record<string, number>>;
  readonly updatedAt: string;
};

const REQUIRED_KEYS = [
  "activeInstalls",
  "byArch",
  "byOs",
  "byVersion",
  "day",
  "lifetimeInstalls",
  "schemaVersion",
  "updatedAt",
] as const;

export function resolveAnalyticsMetricsUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const fromEnv =
    typeof env.KUNAI_ANALYTICS_METRICS_URL === "string"
      ? env.KUNAI_ANALYTICS_METRICS_URL.trim()
      : "";
  return fromEnv || DEFAULT_ANALYTICS_METRICS_URL;
}

function isCountMap(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(
    (count) => typeof count === "number" && Number.isFinite(count) && count >= 0,
  );
}

export function parseDocsAnalyticsMetrics(raw: unknown): DocsAnalyticsMetrics | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== REQUIRED_KEYS.length) return null;
  for (let i = 0; i < REQUIRED_KEYS.length; i += 1) {
    if (keys[i] !== REQUIRED_KEYS[i]) return null;
  }
  if (record.schemaVersion !== 2) return null;
  if (typeof record.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(record.day)) return null;
  if (
    typeof record.activeInstalls !== "number" ||
    !Number.isFinite(record.activeInstalls) ||
    record.activeInstalls < 0
  ) {
    return null;
  }
  if (
    typeof record.lifetimeInstalls !== "number" ||
    !Number.isFinite(record.lifetimeInstalls) ||
    record.lifetimeInstalls < 0
  ) {
    return null;
  }
  if (!isCountMap(record.byVersion)) return null;
  if (!isCountMap(record.byOs)) return null;
  if (!isCountMap(record.byArch)) return null;
  if (typeof record.updatedAt !== "string" || !record.updatedAt) return null;
  return {
    schemaVersion: 2,
    day: record.day,
    activeInstalls: Math.floor(record.activeInstalls),
    lifetimeInstalls: Math.floor(record.lifetimeInstalls),
    byVersion: record.byVersion,
    byOs: record.byOs,
    byArch: record.byArch,
    updatedAt: record.updatedAt,
  };
}

export type ShareBucket = {
  readonly label: string;
  readonly count: number;
  /** Fraction of the breakdown total, 0–1. */
  readonly share: number;
  /** True for the folded remainder, which is a residual and not a category. */
  readonly residual: boolean;
};

/** The ingest's own name for the suppressed remainder. */
const RESIDUAL_LABEL = "other";

/** Visible rows before the tail folds into the residual. */
const DEFAULT_BUCKET_LIMIT = 6;

/**
 * Rank a breakdown for display: largest first, with the ingest's suppressed
 * `other` bucket and any folded tail pinned last as a single residual row.
 *
 * The residual is kept separate from the ranked categories because it is not
 * one — it is what small-cell suppression left over, and charting it as a peer
 * would invite reading it as a real version or platform.
 */
export function rankShareBuckets(
  counts: Readonly<Record<string, number>>,
  limit: number = DEFAULT_BUCKET_LIMIT,
): readonly ShareBucket[] {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total <= 0) return [];

  const named = Object.entries(counts)
    .filter(([label]) => label !== RESIDUAL_LABEL)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));

  const visible = named.slice(0, limit);
  const foldedTail = named.slice(limit).reduce((sum, [, count]) => sum + count, 0);
  const residual = (counts[RESIDUAL_LABEL] ?? 0) + foldedTail;

  const ranked: ShareBucket[] = visible.map(([label, count]) => ({
    label,
    count,
    share: count / total,
    residual: false,
  }));

  if (residual > 0) {
    ranked.push({
      label: RESIDUAL_LABEL,
      count: residual,
      share: residual / total,
      residual: true,
    });
  }

  return ranked;
}

export function formatUsageLine(metrics: DocsAnalyticsMetrics): string {
  return `Installs active on ${metrics.day}: ${metrics.activeInstalls} · lifetime ${metrics.lifetimeInstalls}`;
}

export async function fetchDocsAnalyticsMetrics(options?: {
  readonly url?: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<DocsAnalyticsMetrics | null> {
  const url = options?.url ?? resolveAnalyticsMetricsUrl();
  if (!url) return null;
  const fetchImpl = options?.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      next: { revalidate: 3600 },
    });
    if (!response.ok) return null;
    const json: unknown = await response.json();
    return parseDocsAnalyticsMetrics(json);
  } catch {
    return null;
  }
}
