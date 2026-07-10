import { applyUserProviderSwitch } from "@/app/playback/playback-provider-switch";
import type { Container } from "@/container";
import type { EpisodeInfo, ShellMode, TitleInfo } from "@/domain/types";
import {
  isProviderFallbackEligible,
  resolveEffectiveProviderHealth,
} from "@/services/playback/provider-health-policy";
import type { ProviderHealth, ProviderId } from "@kunai/types";

export type FallbackProviderCandidate = {
  readonly metadata: {
    readonly id: string;
  };
};

export type PickCompatibleFallbackProviderOptions = {
  readonly getProviderHealth?: (providerId: ProviderId) => ProviderHealth | undefined;
  readonly suggestedProviderId?: string | null;
  readonly now?: () => Date;
};

export type FallbackPickResult = {
  readonly provider: FallbackProviderCandidate;
  readonly degradedAllDown: boolean;
};

export function pickCompatibleFallbackProviderDetailed(
  providers: readonly FallbackProviderCandidate[],
  currentProviderId: string,
  options: PickCompatibleFallbackProviderOptions = {},
): FallbackPickResult | undefined {
  const now = options.now ?? (() => new Date());
  const alternates = providers.filter((candidate) => candidate.metadata.id !== currentProviderId);
  if (alternates.length === 0) return undefined;

  const eligible = alternates.filter((candidate) => {
    if (!options.getProviderHealth) return true;
    const stored = options.getProviderHealth(candidate.metadata.id as ProviderId);
    const effective = resolveEffectiveProviderHealth(stored, now());
    return isProviderFallbackEligible(effective);
  });

  const degradedAllDown = eligible.length === 0 && alternates.length > 0;
  const pool = degradedAllDown ? alternates : eligible;
  const suggestedId = options.suggestedProviderId?.trim();
  if (suggestedId) {
    const suggested = pool.find((candidate) => candidate.metadata.id === suggestedId);
    if (suggested) return { provider: suggested, degradedAllDown };
  }
  const provider = pool[0];
  if (!provider) return undefined;
  return { provider, degradedAllDown };
}

export function pickCompatibleFallbackProvider(
  providers: readonly FallbackProviderCandidate[],
  currentProviderId: string,
  options: PickCompatibleFallbackProviderOptions = {},
): FallbackProviderCandidate | undefined {
  return pickCompatibleFallbackProviderDetailed(providers, currentProviderId, options)?.provider;
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
