import type { RecoveryMode } from "@/domain/recovery/RecoveryPolicy";
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
  readonly getProviderHealth?: (
    providerId: ProviderId,
  ) => Pick<ProviderHealth, "status"> | undefined;
  readonly suggestion?: {
    readonly providerId?: string;
    readonly suggestedProviderId: string;
  } | null;
};

export type ProviderCandidatePlan = {
  readonly candidateIds: readonly ProviderId[];
  readonly hasCompatibleFallback: boolean;
  readonly cappedFallbackProviderId?: ProviderId;
};

export function planProviderCandidates(
  input: ProviderCandidatePlannerInput,
): ProviderCandidatePlan {
  const compatibleFallbackIds = input.modules
    .filter((module) => module.providerId !== input.primaryProviderId)
    .filter((module) => module.manifest.mediaKinds.includes(input.mediaKind))
    .filter((module) => input.getProviderHealth?.(module.providerId)?.status !== "down")
    .map((module) => module.providerId);

  const hasCompatibleFallback = compatibleFallbackIds.length > 0;
  if (input.recoveryMode === "manual") {
    return {
      candidateIds: [input.primaryProviderId],
      hasCompatibleFallback,
    };
  }

  // Title health suggestions are advisory for UX copy only. Runtime ordering
  // stays deterministic until a provider is explicitly selected.
  void input.suggestion;

  const candidateIds = [input.primaryProviderId, ...compatibleFallbackIds];
  if (input.recoveryMode === "guided" && candidateIds.length > 2) {
    return {
      candidateIds: candidateIds.slice(0, 2),
      hasCompatibleFallback,
      cappedFallbackProviderId: candidateIds[1],
    };
  }

  return {
    candidateIds,
    hasCompatibleFallback,
  };
}
