import type { Container } from "@/container";
import type { EpisodeInfo, ShellMode, TitleInfo } from "@/domain/types";
import {
  isProviderFallbackEligible,
  resolveEffectiveProviderHealth,
} from "@/services/playback/provider-health-policy";
import type { ProviderId } from "@kunai/types";

import { invalidateEpisodePlaybackCaches } from "./playback-source-cache-invalidation";

export type FallbackProviderCandidate = {
  readonly metadata: {
    readonly id: string;
    readonly name?: string;
  };
};

/**
 * Pick the next provider a fallback action should land on. Candidates arrive
 * in configured-priority order (`getCompatible`), so `find` returns the
 * highest-priority provider that is not the current one, has not already run
 * in this fallback cycle, and is not health-gated out of fallback. Callers
 * that want a "is any fallback available" check use the same function so the
 * footer, the keybinding handler, and the engine cannot disagree about the
 * target.
 */
export function pickCompatibleFallbackProvider(input: {
  readonly providers: readonly FallbackProviderCandidate[];
  readonly currentProviderId: string;
  /** Providers already attempted this cycle — excluded so ⇧F walks forward. */
  readonly excludedProviderIds?: ReadonlySet<string>;
  /** Extra gate, e.g. health-aware fallback eligibility. Defaults to allow. */
  readonly isFallbackEligible?: (providerId: string) => boolean;
}): FallbackProviderCandidate | undefined {
  return input.providers.find(
    (candidate) =>
      candidate.metadata.id !== input.currentProviderId &&
      !input.excludedProviderIds?.has(candidate.metadata.id) &&
      (input.isFallbackEligible?.(candidate.metadata.id) ?? true),
  );
}

/**
 * Health gate for manual fallback targets. A provider marked down is skipped
 * by the candidate planner on the auto path; a panic-key hop into it would
 * burn a full resolve budget on a provider we already know is failing.
 */
export function isProviderIdFallbackEligible(
  container: Pick<Container, "providerHealth">,
  providerId: string,
): boolean {
  return isProviderFallbackEligible(
    resolveEffectiveProviderHealth(container.providerHealth.get(providerId as ProviderId)),
  );
}

/**
 * Session-scoped provider hop for ⇧F and the automatic failover cascade.
 *
 * Unlike `applyUserProviderSwitch` (the explicit picker switch), this does NOT
 * persist a per-title preference and does NOT clear learned per-title provider
 * health: a recovery gesture should neither silently write config nor erase
 * the failure memory that taught the planner to route around the provider we
 * are abandoning. If the hop proves out, `promoteSoftFallbackAfterEngage` is
 * the deliberate path that makes it durable.
 */
export async function switchPlaybackProviderFallback(input: {
  readonly container: Container;
  readonly fromProviderId: string;
  readonly toProviderId: string;
  readonly title: TitleInfo;
  readonly episode: EpisodeInfo;
  readonly mode: ShellMode;
  readonly invalidateRecentEpisodeStream: (episode: EpisodeInfo) => void;
}): Promise<{ readonly fromProviderId: string; readonly providerId: string }> {
  const { container, fromProviderId, toProviderId, title, episode } = input;
  if (fromProviderId === toProviderId) {
    return { fromProviderId, providerId: toProviderId };
  }

  const { stateManager, config, cacheStore, sourceInventory, providerRegistry } = container;
  const mode = input.mode ?? stateManager.getState().mode;

  stateManager.dispatch({
    type: "SET_PROVIDER",
    provider: toProviderId,
    forceFreshResolve: true,
  });

  // Invalidate both sides of the hop: the abandoned provider's cached stream
  // is suspect (something made the user leave), and the target's stale
  // failures must not gate the fresh attempt.
  const compatibleProviderIds = new Set(
    providerRegistry.getCompatible(title, mode).map((provider) => provider.metadata.id),
  );
  const providerIds = [fromProviderId, toProviderId].filter(
    (providerId, index, ids) =>
      ids.indexOf(providerId) === index && compatibleProviderIds.has(providerId),
  );
  const configRaw = config.getRaw();
  await Promise.all(
    providerIds.map((providerId) =>
      invalidateEpisodePlaybackCaches({
        cacheStore,
        sourceInventory,
        providerId,
        title,
        episode,
        mode,
        config: configRaw,
      }),
    ),
  );

  container.diagnosticsService.record({
    category: "ui",
    message: "Session-scoped provider fallback applied",
    context: {
      mode,
      from: fromProviderId,
      to: toProviderId,
      titleId: title.id,
      season: episode.season,
      episode: episode.episode,
      persistedPreference: false,
      invalidatedProviders: providerIds.length,
    },
  });

  input.invalidateRecentEpisodeStream(episode);
  return { fromProviderId, providerId: toProviderId };
}
