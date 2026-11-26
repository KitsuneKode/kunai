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
  /**
   * The user just chose this provider (a switch, `/recompute`, manual mode):
   * it leads whatever its health, and title suggestions do not reorder it.
   */
  readonly keepPrimaryFirst?: boolean;
  /** Display names for `orderNote`; ids are used when omitted. */
  readonly nameOf?: (providerId: ProviderId) => string;
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
  /** Why the order differs from "your provider first", for the loading line. */
  readonly orderNote?: string;
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

  const fallbacks = orderProviderCandidates(compatibleFallbackIds, effectiveHealthById);
  const primary = input.primaryProviderId;
  const name = (id: ProviderId) => input.nameOf?.(id) ?? id;
  if (input.keepPrimaryFirst === true || fallbacks.length === 0) {
    return {
      candidateIds: [primary, ...fallbacks],
      hasCompatibleFallback,
      skippedFallbackProviders,
    };
  }

  // A provider that failed for this title before, with a named alternative
  // that worked, starts from the alternative; the selected provider follows it.
  const suggested =
    input.suggestion &&
    (input.suggestion.providerId ?? primary) === primary &&
    fallbacks.includes(input.suggestion.suggestedProviderId)
      ? input.suggestion.suggestedProviderId
      : undefined;
  // The selected provider normally leads. While its health is `down` (recent
  // definitive failures, healing by TTL) it goes last instead of spending the
  // first attempt; it is still tried, so a recovered provider is noticed.
  const primaryHealth =
    input.ignoreProviderHealth === true
      ? undefined
      : resolveEffectiveProviderHealth(input.getProviderHealth?.(primary), now());
  const primaryDown = !isProviderFallbackEligible(primaryHealth) && primaryHealth !== undefined;
  const rest = fallbacks.filter((id) => id !== suggested);
  const candidateIds: ProviderId[] = suggested ? [suggested] : [];
  if (!primaryDown) candidateIds.push(primary);
  candidateIds.push(...rest);
  if (primaryDown) candidateIds.push(primary);
  const notes = [
    suggested ? `Trying ${name(suggested)} first: it worked for this title before.` : undefined,
    primaryDown
      ? `${name(primary)} is down (${primaryHealth?.consecutiveFailures ?? "repeated"} failures), so it is tried last.`
      : undefined,
  ].filter((note): note is string => note !== undefined);
  return {
    candidateIds,
    hasCompatibleFallback,
    skippedFallbackProviders,
    orderNote: notes.length > 0 ? notes.join(" ") : undefined,
  };
}
