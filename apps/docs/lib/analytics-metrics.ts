/**
 * Quiet public usage analytics metrics for the docs home.
 * Fetches aggregates only — never Redis, never install ids.
 */

export const DEFAULT_ANALYTICS_METRICS_URL =
  "https://kunai-analytics.vercel.app/metrics/daily.json";

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

export function formatUsageLine(metrics: DocsAnalyticsMetrics): string {
  return `Installs active on ${metrics.day}: ${metrics.activeInstalls} · lifetime ${metrics.lifetimeInstalls}`;
}

export async function fetchDocsAnalyticsMetrics(options?: {
  readonly url?: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<DocsAnalyticsMetrics | null> {
  const url = options?.url ?? resolveAnalyticsMetricsUrl();
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
