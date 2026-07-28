import type { ProviderId } from "@kunai/types";

import type { EffectiveProviderHealthStatus } from "./provider-health-policy";

/**
 * Minimum age before a `down` provider is worth probing again. Without this a
 * burst of resolves would probe the same dead provider repeatedly and turn a
 * recovery mechanism into an outbound-request amplifier.
 */
const MIN_REPROBE_AGE_MS = 15 * 60 * 1000;

export interface ShadowProbeInput {
  readonly candidates: readonly (ProviderId | string)[];
  readonly health: Readonly<
    Record<
      string,
      { readonly effectiveStatus: EffectiveProviderHealthStatus; readonly checkedAt?: string }
    >
  >;
  /** Provider serving this resolve. Never probed — it is already being exercised. */
  readonly activeProviderId: ProviderId | string;
  readonly now?: () => number;
}

/**
 * Choose at most one `down` provider to probe off the critical path.
 *
 * `down` providers are excluded from fallback, so they cannot succeed, so
 * nothing but a 4-hour TTL heals them — live evidence had youtube unchecked for
 * eight days. Probing replaces that timer with evidence, but only ever one per
 * resolve, and never the provider currently serving the user, whose outcome is
 * already being observed.
 *
 * Selection only. Choosing a target is separable from paying for the request,
 * and the executor waits on a latency baseline that shows the resolve deadline
 * can absorb it.
 *
 * Returns `null` when there is nothing worth probing.
 */
export function selectShadowProbeTarget(input: ShadowProbeInput): ProviderId | null {
  const nowMs = (input.now ?? Date.now)();

  const stale = input.candidates
    .filter((providerId) => providerId !== input.activeProviderId)
    .map((providerId) => ({ providerId, entry: input.health[providerId] }))
    .filter((row) => row.entry?.effectiveStatus === "down")
    .map((row) => {
      const checkedAt = row.entry?.checkedAt;
      const checkedAtMs = checkedAt ? Date.parse(checkedAt) : Number.NaN;
      // An unparseable timestamp is unusable data, not evidence of a recent
      // check — treat it as fully stale so the provider can earn its way back.
      const ageMs = Number.isFinite(checkedAtMs) ? nowMs - checkedAtMs : Number.POSITIVE_INFINITY;
      return { providerId: row.providerId, ageMs };
    })
    .filter((row) => row.ageMs >= MIN_REPROBE_AGE_MS)
    .sort((left, right) => right.ageMs - left.ageMs);

  return (stale[0]?.providerId as ProviderId | undefined) ?? null;
}
