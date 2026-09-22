import { applyUserProviderSwitch } from "@/app/playback/playback-provider-switch";
import type { Container } from "@/container";
import type { EpisodeInfo, ShellMode, TitleInfo } from "@/domain/types";
import {
  isProviderFallbackEligible,
  resolveEffectiveProviderHealth,
} from "@/services/playback/provider-health-policy";
import type { ProviderHealthRepository } from "@kunai/storage";
import type { ProviderId } from "@kunai/types";

export type FallbackProviderCandidate = {
  readonly metadata: {
    readonly id: string;
    readonly name?: string;
  };
};

/**
 * Eligibility predicate for fallback targets. Providers the health policy
 * reports as `down` are already excluded from engine auto-fallback; a manual
 * or stall-triggered hop landing on them would just burn the dead provider's
 * timeout and need a second hop. Healthy, degraded, and unknown stay
 * eligible — degraded still resolves, unknown is no evidence.
 */
export function providerFallbackEligibility(
  providerHealth: Pick<ProviderHealthRepository, "get">,
): (providerId: string) => boolean {
  return (providerId) =>
    isProviderFallbackEligible(
      resolveEffectiveProviderHealth(providerHealth.get(providerId as ProviderId)),
    );
}

export function pickCompatibleFallbackProvider(
  providers: readonly FallbackProviderCandidate[],
  currentProviderId: string,
  isEligible: (providerId: string) => boolean = () => true,
): FallbackProviderCandidate | undefined {
  return providers.find(
    (candidate) => candidate.metadata.id !== currentProviderId && isEligible(candidate.metadata.id),
  );
}

export async function switchPlaybackProviderFallback(input: {
  readonly container: Container;
  readonly fromProviderId: string;
  readonly toProviderId: string;
  readonly title: TitleInfo;
  readonly episode: EpisodeInfo;
  readonly mode: ShellMode;
  readonly invalidateRecentEpisodeStream: (episode: EpisodeInfo) => void;
}): Promise<{ readonly fromProviderId: string; readonly providerId: string }> {
  await applyUserProviderSwitch({
    container: input.container,
    fromProviderId: input.fromProviderId,
    toProviderId: input.toProviderId,
    title: input.title,
    episode: input.episode,
    mode: input.mode,
  });
  input.invalidateRecentEpisodeStream(input.episode);
  return {
    fromProviderId: input.fromProviderId,
    providerId: input.toProviderId,
  };
}
