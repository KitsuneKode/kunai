import type { ProviderId } from "@kunai/types";

import type {
  EffectiveProviderHealth,
  EffectiveProviderHealthStatus,
} from "./provider-health-policy";

/**
 * Sort weight per effective status. Lower sorts earlier.
 *
 * `unknown` ranks with `healthy` on purpose: no data is not evidence of being
 * broken, and demoting unmeasured providers would bury every newly added one.
 */
const STATUS_RANK: Record<EffectiveProviderHealthStatus, number> = {
  healthy: 0,
  unknown: 0,
  degraded: 1,
  down: 2,
};

/**
 * Order provider candidates for this resolve.
 *
 * The user's configured priority is authoritative and is preserved exactly
 * whenever health is equal — predictable ordering is a real UX property, and
 * this must never become a speed sort. Health and latency act only as
 * tie-breaks, which changes nothing for a user whose priority list already
 * covers their providers and helps everyone else.
 *
 * Applied to fallback candidates only. The provider the user selected leads the
 * list regardless of how it ranks here.
 */
export function orderProviderCandidates(
  candidates: readonly ProviderId[],
  health: Readonly<Record<string, EffectiveProviderHealth | undefined>>,
): readonly ProviderId[] {
  return [...candidates]
    .map((providerId, configuredIndex) => ({ providerId, configuredIndex }))
    .sort((left, right) => {
      const leftHealth = health[left.providerId];
      const rightHealth = health[right.providerId];

      const leftRank = STATUS_RANK[leftHealth?.effectiveStatus ?? "unknown"];
      const rightRank = STATUS_RANK[rightHealth?.effectiveStatus ?? "unknown"];
      if (leftRank !== rightRank) return leftRank - rightRank;

      // Unmeasured providers sort after measured ones rather than ahead of
      // them: an unknown latency is not evidence of speed.
      const leftMs = leftHealth?.stored?.medianResolveMs ?? Number.POSITIVE_INFINITY;
      const rightMs = rightHealth?.stored?.medianResolveMs ?? Number.POSITIVE_INFINITY;
      if (leftMs !== rightMs) return leftMs - rightMs;

      return left.configuredIndex - right.configuredIndex;
    })
    .map((entry) => entry.providerId);
}
