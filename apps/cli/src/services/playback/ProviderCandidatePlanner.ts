import type { RecoveryMode } from "@/domain/recovery/RecoveryPolicy";
import {
  isProviderFallbackEligible,
  resolveEffectiveProviderHealth,
  type EffectiveProviderHealth,
} from "@/services/playback/provider-health-policy";
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

export type SkippedFallbackProvider = {
  readonly providerId: ProviderId;
  readonly effectiveHealth: EffectiveProviderHealth;
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
  const compatibleFallbackIds = input.modules
    .filter((module) => module.providerId !== input.primaryProviderId)
    .filter((module) => module.manifest.mediaKinds.includes(input.mediaKind))
    .filter((module) => {
      if (input.ignoreProviderHealth === true) return true;
      const stored = input.getProviderHealth?.(module.providerId);
      const effective = resolveEffectiveProviderHealth(stored, now());
      if (!isProviderFallbackEligible(effective)) {
        if (effective)
          skippedFallbackProviders.push({
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

  return {
    candidateIds: [input.primaryProviderId, ...compatibleFallbackIds],
    hasCompatibleFallback,
    skippedFallbackProviders,
  };
}
