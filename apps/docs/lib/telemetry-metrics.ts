/**
 * Quiet public opt-in telemetry metrics for the docs home.
 * Fetches aggregates only — never Redis, never install ids.
 */

export const DEFAULT_TELEMETRY_METRICS_URL =
  "https://kunai-telemetry.vercel.app/metrics/daily.json";

export type DocsTelemetryMetrics = {
  readonly schemaVersion: 1;
  readonly day: string;
  readonly activeInstalls: number;
  readonly lifetimeInstallsApprox: number;
  readonly lifetimeMethod: "hyperloglog";
  readonly updatedAt: string;
};

const REQUIRED_KEYS = [
  "activeInstalls",
  "day",
  "lifetimeInstallsApprox",
  "lifetimeMethod",
  "schemaVersion",
  "updatedAt",
] as const;

export function resolveTelemetryMetricsUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const fromEnv =
    typeof env.KUNAI_TELEMETRY_METRICS_URL === "string"
      ? env.KUNAI_TELEMETRY_METRICS_URL.trim()
      : "";
  return fromEnv || DEFAULT_TELEMETRY_METRICS_URL;
}

export function parseDocsTelemetryMetrics(raw: unknown): DocsTelemetryMetrics | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== REQUIRED_KEYS.length) return null;
  for (let i = 0; i < REQUIRED_KEYS.length; i += 1) {
    if (keys[i] !== REQUIRED_KEYS[i]) return null;
  }
  if (record.schemaVersion !== 1) return null;
  if (typeof record.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(record.day)) return null;
  if (typeof record.activeInstalls !== "number" || !Number.isFinite(record.activeInstalls)) {
    return null;
  }
  if (
    typeof record.lifetimeInstallsApprox !== "number" ||
    !Number.isFinite(record.lifetimeInstallsApprox)
  ) {
    return null;
  }
  if (record.lifetimeMethod !== "hyperloglog") return null;
  if (typeof record.updatedAt !== "string" || !record.updatedAt) return null;
  if (record.activeInstalls < 0 || record.lifetimeInstallsApprox < 0) return null;
  return {
    schemaVersion: 1,
    day: record.day,
    activeInstalls: Math.floor(record.activeInstalls),
    lifetimeInstallsApprox: Math.floor(record.lifetimeInstallsApprox),
    lifetimeMethod: "hyperloglog",
    updatedAt: record.updatedAt,
  };
}

export function formatOptInTelemetryLine(metrics: DocsTelemetryMetrics): string {
  return `Opt-in installs on ${metrics.day}: ${metrics.activeInstalls} · lifetime ~${metrics.lifetimeInstallsApprox}`;
}

export async function fetchDocsTelemetryMetrics(options?: {
  readonly url?: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<DocsTelemetryMetrics | null> {
  const url = options?.url ?? resolveTelemetryMetricsUrl();
  const fetchImpl = options?.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      next: { revalidate: 3600 },
    });
    if (!response.ok) return null;
    const json: unknown = await response.json();
    return parseDocsTelemetryMetrics(json);
  } catch {
    return null;
  }
}
