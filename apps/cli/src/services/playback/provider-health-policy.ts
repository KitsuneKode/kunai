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

export function resolveEffectiveProviderHealth(
  stored: ProviderHealth | undefined,
  now: Date = new Date(),
): EffectiveProviderHealth | undefined {
  if (!stored) return undefined;

  const checkedAtMs = Date.parse(stored.checkedAt);
  const ageMs = Number.isFinite(checkedAtMs) ? Math.max(0, now.getTime() - checkedAtMs) : 0;
  const effectiveStatus = resolveEffectiveStatus(stored.status, ageMs);

  return {
    providerId: stored.providerId,
    stored,
    effectiveStatus,
    checkedAt: stored.checkedAt,
    consecutiveFailures: stored.consecutiveFailures,
    recentFailureRate: stored.recentFailureRate,
    healedByTtl: effectiveStatus !== stored.status,
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
