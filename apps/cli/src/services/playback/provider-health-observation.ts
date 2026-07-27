/**
 * Provider failure-rate accounting.
 *
 * `recentFailureRate` is an exponentially weighted moving average. It was
 * previously seeded at 1 on a first-ever failure, which made "failed once"
 * numerically identical to "fails every time" — the reason a provider could
 * sit at a reported 100% failure rate after a single bad attempt.
 *
 * Seeding at one step instead means evidence has to accumulate before the
 * rate looks alarming, and `observations` records how much evidence there is
 * so a consumer can refuse to act on a number backed by two samples.
 */

import type { ProviderHealth, ProviderHealthDelta } from "@kunai/types";

/** Weight retained from prior history on each update. */
export const FAILURE_RATE_DECAY = 0.7;

/** Weight contributed by the newest outcome. */
export const FAILURE_RATE_STEP = 0.3;

function sanitizeRate(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1, value));
}

/**
 * Fold one outcome into the running failure rate.
 * Sustained failure converges on 1; sustained success converges on 0.
 */
export function nextFailureRate(previous: number | undefined, failed: boolean): number {
  const prior = sanitizeRate(previous);
  if (prior === undefined) {
    return failed ? FAILURE_RATE_STEP : 0;
  }
  const raw = prior * FAILURE_RATE_DECAY + (failed ? FAILURE_RATE_STEP : 0);
  return Math.max(0, Math.min(1, raw));
}

/** Count one more recorded outcome. Corrupt history restarts the count. */
export function nextObservations(previous: number | undefined): number {
  if (previous === undefined || !Number.isFinite(previous) || previous < 0) return 1;
  return Math.floor(previous) + 1;
}

/**
 * Fold one resolve outcome into a provider's stored health record.
 *
 * Status still keys off the consecutive-failure streak, which is what makes a
 * provider recover the instant it succeeds again. The failure rate is the
 * slower-moving signal and is deliberately not allowed to set status on its
 * own here; that judgement lives in `provider-health-policy`.
 */
export function computeProviderHealthUpdate(
  existing: ProviderHealth | undefined,
  delta: ProviderHealthDelta,
): ProviderHealth {
  const succeeded = delta.outcome === "success";
  // A stall clears the streak but still counts against the rate: playback did
  // start, so the provider is not dead, but the attempt did not serve the user.
  const clearsStreak = succeeded || delta.outcome === "stalled";

  const consecutiveFailures = clearsStreak ? 0 : (existing?.consecutiveFailures ?? 0) + 1;

  return {
    providerId: delta.providerId,
    status: consecutiveFailures >= 5 ? "down" : consecutiveFailures >= 2 ? "degraded" : "healthy",
    checkedAt: delta.at,
    medianResolveMs: delta.resolveMs,
    recentFailureRate: nextFailureRate(existing?.recentFailureRate, !succeeded),
    observations: nextObservations(existing?.observations),
    consecutiveFailures,
    subtitleSuccessRate: undefined,
    streamSurvivalRate: undefined,
  };
}
