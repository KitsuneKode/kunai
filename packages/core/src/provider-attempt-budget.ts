import type { StartupPriority } from "@kunai/types";

/**
 * How long one provider attempt may run before the engine abandons it.
 *
 * This lives in core rather than the CLI because provider cycles have to size
 * their own per-candidate timeouts against it. When the two drifted apart, both
 * Miruro and Videasy ended up with a 20s candidate timeout inside a 12s attempt:
 * the candidate bound could never fire, so a single hung mirror consumed the
 * whole attempt and the cycle never reached its remaining candidates.
 */
const PROVIDER_ATTEMPT_TIMEOUT_MS: Record<StartupPriority, number> = {
  fast: 6_000,
  balanced: 12_000,
  "quality-first": 30_000,
};

export function providerAttemptTimeoutMs(startupPriority: StartupPriority): number {
  return PROVIDER_ATTEMPT_TIMEOUT_MS[startupPriority];
}

/**
 * Clamp a provider's chosen per-candidate timeout to something the attempt can
 * actually reach.
 *
 * Providers know their own candidate cost: Miruro wants a short bound so a
 * Cloudflare-gated mirror cannot eat the attempt and starve the mirrors behind
 * it, while Videasy wants a slow flavor to finish rather than be cut off. So the
 * value stays the provider's call — this only enforces the one thing neither can
 * see, that a candidate timeout above the attempt budget is dead code.
 *
 * The ceiling keeps headroom below the attempt budget so the candidate bound
 * fires first and the cycle can record a real per-candidate failure, instead of
 * the engine killing the whole attempt with nothing attributable in the trace.
 */
const CANDIDATE_TIMEOUT_CEILING_RATIO = 0.8;

export function providerCycleCandidateTimeoutMs(
  startupPriority: StartupPriority,
  preferredMs?: number,
): number {
  const ceiling = Math.floor(
    providerAttemptTimeoutMs(startupPriority) * CANDIDATE_TIMEOUT_CEILING_RATIO,
  );
  if (preferredMs === undefined) return ceiling;
  return Math.max(1, Math.min(preferredMs, ceiling));
}
