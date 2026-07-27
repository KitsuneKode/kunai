import type { ProviderHealth, ProviderId } from "@kunai/types";

export type EffectiveProviderHealthStatus = ProviderHealth["status"] | "unknown";

export type EffectiveProviderHealth = {
  readonly providerId: ProviderId;
  readonly stored: ProviderHealth | undefined;
  readonly effectiveStatus: EffectiveProviderHealthStatus;
  readonly checkedAt: string | undefined;
  readonly consecutiveFailures: number | undefined;
  readonly recentFailureRate: number | undefined;
  readonly healedByTtl: boolean;
};

const DEGRADED_HEAL_MS = 60 * 60 * 1000;
const DOWN_TO_DEGRADED_MS = 4 * 60 * 60 * 1000;
const DOWN_TO_HEALTHY_MS = 8 * 60 * 60 * 1000;

/**
 * Failure rate at or above which a provider is treated as degraded regardless
 * of its consecutive-failure counter. A provider can fail most attempts while
 * never stringing two together, which previously read as fully healthy.
 */
const SUSTAINED_FAILURE_RATE = 0.75;

/**
 * Minimum recorded outcomes before the rate is trusted. Rows written before
 * `observations` existed report `undefined` and are deliberately exempt: they
 * carry a legacy seed of 1 after a single failure and would all demote at once.
 */
const MIN_RATE_OBSERVATIONS = 4;

function hasSustainedFailures(stored: ProviderHealth): boolean {
  const { recentFailureRate: rate, observations } = stored;
  if (rate === undefined || observations === undefined) return false;
  return observations >= MIN_RATE_OBSERVATIONS && rate >= SUSTAINED_FAILURE_RATE;
}

export function resolveEffectiveProviderHealth(
  stored: ProviderHealth | undefined,
  now: Date = new Date(),
): EffectiveProviderHealth | undefined {
  if (!stored) return undefined;

  const checkedAtMs = Date.parse(stored.checkedAt);
  // Corrupt persistence must fail open. Treating it as freshly checked pins a
  // down provider out of fallback forever; an unknown timestamp is no evidence
  // of a recent failure.
  const ageMs = Number.isFinite(checkedAtMs)
    ? Math.max(0, now.getTime() - checkedAtMs)
    : Number.POSITIVE_INFINITY;
  const agedStatus = resolveEffectiveStatus(stored.status, ageMs);
  // A sustained failure rate demotes, but never promotes: a `down` provider
  // with a clean rate stays down until its TTL or a real success heals it.
  const effectiveStatus =
    agedStatus === "healthy" && hasSustainedFailures(stored) ? "degraded" : agedStatus;

  return {
    providerId: stored.providerId,
    stored,
    effectiveStatus,
    checkedAt: stored.checkedAt,
    consecutiveFailures: stored.consecutiveFailures,
    recentFailureRate: stored.recentFailureRate,
    // Keyed off the aged status, not the final one: being demoted by the
    // failure rate is not healing and must not render as "(was healthy)".
    healedByTtl: agedStatus !== stored.status,
  };
}

function resolveEffectiveStatus(
  storedStatus: ProviderHealth["status"],
  ageMs: number,
): EffectiveProviderHealthStatus {
  if (storedStatus === "down") {
    if (ageMs >= DOWN_TO_HEALTHY_MS) return "healthy";
    if (ageMs >= DOWN_TO_DEGRADED_MS) return "degraded";
    return "down";
  }
  if (storedStatus === "degraded" && ageMs >= DEGRADED_HEAL_MS) {
    return "healthy";
  }
  return storedStatus;
}

export function isProviderFallbackEligible(
  health: Pick<EffectiveProviderHealth, "effectiveStatus"> | undefined,
): boolean {
  return health?.effectiveStatus !== "down";
}

export function formatProviderHealthAge(
  checkedAt: string | undefined,
  now: Date = new Date(),
): string {
  if (!checkedAt) return "unknown age";
  const checkedAtMs = Date.parse(checkedAt);
  if (!Number.isFinite(checkedAtMs)) return "unknown age";
  const deltaMinutes = Math.round((now.getTime() - checkedAtMs) / 60_000);
  if (deltaMinutes < 1) return "just now";
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 48) return `${deltaHours}h ago`;
  return checkedAt.slice(0, 10);
}

export function formatProviderHealthBadge(
  health: EffectiveProviderHealth | undefined,
  now: Date = new Date(),
): string | null {
  if (!health) return null;

  const failures =
    health.consecutiveFailures !== undefined && health.consecutiveFailures > 0
      ? `${health.consecutiveFailures} failure${health.consecutiveFailures === 1 ? "" : "s"}`
      : null;
  const age = formatProviderHealthAge(health.checkedAt, now);
  const statusLabel =
    health.healedByTtl && health.stored
      ? `${health.effectiveStatus} (was ${health.stored.status})`
      : health.effectiveStatus;

  const parts = [statusLabel, failures, age].filter(Boolean);
  if (health.effectiveStatus === "down") {
    parts.push("skipped in auto-fallback");
  }
  return parts.join(" · ");
}

export function formatProviderHealthPickerLabelSuffix(
  health: EffectiveProviderHealth | undefined,
  now: Date = new Date(),
): string | null {
  if (!health) return null;
  if (health.effectiveStatus !== "down" && health.effectiveStatus !== "degraded") {
    return null;
  }
  const badge = formatProviderHealthBadge(health, now);
  return badge ? `  ·  ${badge}` : null;
}
