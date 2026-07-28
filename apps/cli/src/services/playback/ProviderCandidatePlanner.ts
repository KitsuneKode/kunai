import type { RecoveryMode } from "@/domain/recovery/RecoveryPolicy";
import {
  isProviderFallbackEligible,
  resolveEffectiveProviderHealth,
  type EffectiveProviderHealth,
} from "@/services/playback/provider-health-policy";
import { orderProviderCandidates } from "@/services/playback/provider-ordering";
import type { MediaKind, ProviderHealth, ProviderId } from "@kunai/types";

export type ProviderCandidatePlannerModule = {
  readonly providerId: ProviderId;
  readonly manifest: {
    readonly mediaKinds: readonly MediaKind[];
  };
};

export type ProviderCandidatePlannerInput = {
  readonly primaryProviderId: ProviderId;
  readonly mediaKind: MediaKind;
  readonly recoveryMode: RecoveryMode;
  readonly modules: readonly ProviderCandidatePlannerModule[];
  readonly getProviderHealth?: (providerId: ProviderId) => ProviderHealth | undefined;
  readonly ignoreProviderHealth?: boolean;
  readonly now?: () => Date;
  readonly suggestion?: {
    readonly providerId?: string;
    readonly suggestedProviderId: string;
  } | null;
};

/**
 * Why a provider never made it into the candidate list. Every exclusion carries
 * a reason so a short candidate list is explainable rather than mysterious —
 * media-kind drops used to vanish without a trace.
 */
export type SkippedFallbackProvider =
  | {
      readonly reason: "health";
      readonly providerId: ProviderId;
      readonly effectiveHealth: EffectiveProviderHealth;
    }
  | {
      readonly reason: "media-kind";
      readonly providerId: ProviderId;
      readonly requestedMediaKind: MediaKind;
      readonly supportedMediaKinds: readonly MediaKind[];
    };

export type ProviderCandidatePlan = {
  readonly candidateIds: readonly ProviderId[];
  readonly hasCompatibleFallback: boolean;
  readonly skippedFallbackProviders: readonly SkippedFallbackProvider[];
};

export function planProviderCandidates(
  input: ProviderCandidatePlannerInput,
): ProviderCandidatePlan {
  const now = input.now ?? (() => new Date());
  const skippedFallbackProviders: SkippedFallbackProvider[] = [];
  // Captured during eligibility filtering so ordering reuses the same verdict
  // instead of resolving effective health a second time.
  const effectiveHealthById: Record<string, EffectiveProviderHealth | undefined> = {};
  const compatibleFallbackIds = input.modules
    .filter((module) => module.providerId !== input.primaryProviderId)
    .filter((module) => {
      if (module.manifest.mediaKinds.includes(input.mediaKind)) return true;
      skippedFallbackProviders.push({
        reason: "media-kind",
        providerId: module.providerId,
        requestedMediaKind: input.mediaKind,
        supportedMediaKinds: module.manifest.mediaKinds,
      });
      return false;
    })
    .filter((module) => {
      if (input.ignoreProviderHealth === true) return true;
      const stored = input.getProviderHealth?.(module.providerId);
      const effective = resolveEffectiveProviderHealth(stored, now());
      effectiveHealthById[module.providerId] = effective;
      if (!isProviderFallbackEligible(effective)) {
        if (effective)
          skippedFallbackProviders.push({
            reason: "health",
            providerId: module.providerId,
            effectiveHealth: effective,
          });
        return false;
      }
      return true;
    })
    .map((module) => module.providerId);

  const hasCompatibleFallback = compatibleFallbackIds.length > 0;
  if (input.recoveryMode === "manual") {
    return {
      candidateIds: [input.primaryProviderId],
      hasCompatibleFallback,
      skippedFallbackProviders,
    };
  }

  // Title health suggestions are advisory for UX copy only. Runtime ordering
  // stays deterministic until a provider is explicitly selected.
  void input.suggestion;

  // The selected provider leads regardless of how it ranks; only the order we
  // fall back through is health- and latency-aware.
  return {
    candidateIds: [
      input.primaryProviderId,
      ...orderProviderCandidates(compatibleFallbackIds, effectiveHealthById),
    ],
    hasCompatibleFallback,
    skippedFallbackProviders,
  };
}
