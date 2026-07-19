import type { DailyDistinctStore, LifetimeStore } from "./ingest";
import { utcDayKey } from "./ingest";
import { REDIS_KEYS } from "./redis-keys";
import type { UpstashRedis } from "./upstash-client";

export const METRICS_SCHEMA_VERSION = 1;

export type PublicTelemetryMetrics = {
  readonly schemaVersion: typeof METRICS_SCHEMA_VERSION;
  readonly day: string;
  readonly activeInstalls: number;
  readonly lifetimeInstallsApprox: number;
  readonly lifetimeMethod: "hyperloglog";
  readonly updatedAt: string;
};

export function buildPublicMetricsSnapshot(input: {
  readonly day: string;
  readonly activeInstalls: number;
  readonly lifetimeInstallsApprox: number;
  readonly updatedAt?: string;
}): PublicTelemetryMetrics {
  return {
    schemaVersion: METRICS_SCHEMA_VERSION,
    day: input.day,
    activeInstalls: Math.max(0, Math.floor(input.activeInstalls)),
    lifetimeInstallsApprox: Math.max(0, Math.floor(input.lifetimeInstallsApprox)),
    lifetimeMethod: "hyperloglog",
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
}

const PUBLIC_METRICS_KEYS = [
  "activeInstalls",
  "day",
  "lifetimeInstallsApprox",
  "lifetimeMethod",
  "schemaVersion",
  "updatedAt",
] as const;

export function parsePublicMetricsSnapshot(raw: unknown): PublicTelemetryMetrics | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== PUBLIC_METRICS_KEYS.length) return null;
  for (let i = 0; i < PUBLIC_METRICS_KEYS.length; i += 1) {
    if (keys[i] !== PUBLIC_METRICS_KEYS[i]) return null;
  }
  if (record.schemaVersion !== METRICS_SCHEMA_VERSION) return null;
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
  return buildPublicMetricsSnapshot({
    day: record.day,
    activeInstalls: record.activeInstalls,
    lifetimeInstallsApprox: record.lifetimeInstallsApprox,
    updatedAt: record.updatedAt,
  });
}

/** Prefer yesterday's day-count for the public "active installs" line. */
export function snapshotDayKey(now = Date.now()): string {
  return utcDayKey(now - 24 * 60 * 60 * 1000);
}

export async function collectPublicMetrics(input: {
  readonly daily: DailyDistinctStore;
  readonly lifetime: LifetimeStore;
  readonly now?: number;
}): Promise<PublicTelemetryMetrics> {
  const now = input.now ?? Date.now();
  const day = snapshotDayKey(now);
  const activeInstalls = await input.daily.count(day);
  const lifetimeInstallsApprox = await input.lifetime.approxCount();
  return buildPublicMetricsSnapshot({
    day,
    activeInstalls,
    lifetimeInstallsApprox,
    updatedAt: new Date(now).toISOString(),
  });
}

export async function writePublicMetricsToRedis(
  redis: UpstashRedis,
  metrics: PublicTelemetryMetrics,
): Promise<void> {
  await redis.command("SET", REDIS_KEYS.publicSnapshot(), JSON.stringify(metrics));
}

export async function readPublicMetricsFromRedis(
  redis: UpstashRedis,
): Promise<PublicTelemetryMetrics | null> {
  const raw = await redis.command<string | null>("GET", REDIS_KEYS.publicSnapshot());
  if (!raw) return null;
  try {
    return parsePublicMetricsSnapshot(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}
