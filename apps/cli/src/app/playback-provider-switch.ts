import type { Container } from "@/container";
import type { EpisodeInfo, ShellMode, TitleInfo } from "@/domain/types";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

import { invalidateEpisodePlaybackCaches } from "./playback-source-cache-invalidation";

export function resolveTitleProviderPreference(
  config: Pick<KitsuneConfig, "titleProviderPreferences">,
  titleId: string,
): string | undefined {
  return config.titleProviderPreferences[titleId];
}

async function persistTitleProviderPreference(
  container: Pick<Container, "config">,
  titleId: string,
  providerId: string,
): Promise<void> {
  const raw = container.config.getRaw();
  if (raw.titleProviderPreferences[titleId] === providerId) return;
  await container.config.update({
    titleProviderPreferences: {
      ...raw.titleProviderPreferences,
      [titleId]: providerId,
    },
  });
  await container.config.save();
}

/**
 * Apply a saved per-title provider before playback/history resume.
 * Returns true when a preference was applied.
 *
 * Preference affects default provider selection and cache invalidation on
 * explicit switch; it does not disable automatic fallback when that provider
 * cannot resolve the episode (see honorExplicitProviderOnly in PlaybackPhase).
 */
export function applyTitleProviderPreferenceToSession(
  container: Pick<Container, "config" | "stateManager" | "providerRegistry">,
  titleId: string,
): boolean {
  const preferred = resolveTitleProviderPreference(container.config.getRaw(), titleId);
  if (!preferred) return false;

  const state = container.stateManager.getState();
  if (state.provider === preferred) return false;

  const provider = container.providerRegistry.get(preferred);
  if (provider) {
    container.stateManager.dispatch({
      type: "SET_MODE",
      mode: provider.metadata.isAnimeProvider ? "anime" : "series",
      provider: preferred,
    });
  } else {
    container.stateManager.dispatch({ type: "SET_PROVIDER", provider: preferred });
  }
  return true;
}

/** User explicitly chose a provider — invalidate stale cross-provider caches and force a fresh resolve. */
export async function applyUserProviderSwitch(input: {
  readonly container: Container;
  readonly fromProviderId: string;
  readonly toProviderId: string;
  readonly title?: TitleInfo;
  readonly episode?: EpisodeInfo;
  readonly mode?: ShellMode;
}): Promise<void> {
  const { container, fromProviderId, toProviderId, title, episode } = input;
  if (fromProviderId === toProviderId) return;

  const {
    stateManager,
    config,
    cacheStore,
    sourceInventory,
    diagnosticsService,
    providerRegistry,
  } = container;
  const state = stateManager.getState();
  const mode = input.mode ?? state.mode;
  const configRaw = config.getRaw();

  stateManager.dispatch({
    type: "SET_PROVIDER",
    provider: toProviderId,
    forceFreshResolve: true,
  });

  if (title) {
    await persistTitleProviderPreference(container, title.id, toProviderId);
    container.titleProviderHealth.clear(title.id);
  }

  if (title && episode) {
    const providerIds = providerRegistry
      .getCompatible(title, mode)
      .map((provider) => provider.metadata.id);
    for (const providerId of providerIds) {
      await invalidateEpisodePlaybackCaches({
        cacheStore,
        sourceInventory,
        providerId,
        title,
        episode,
        mode,
        config: configRaw,
      });
    }
  }

  diagnosticsService.record({
    category: "ui",
    message: "User switched provider with playback cache invalidation",
    context: {
      mode,
      from: fromProviderId,
      to: toProviderId,
      titleId: title?.id ?? null,
      season: episode?.season ?? null,
      episode: episode?.episode ?? null,
      persistedPreference: Boolean(title),
      invalidatedProviders:
        title && episode ? providerRegistry.getCompatible(title, mode).length : 0,
    },
  });
}

export function resolveStreamProviderId(
  stream: { readonly providerResolveResult?: { readonly providerId?: string } } | null,
): string | undefined {
  return stream?.providerResolveResult?.providerId;
}
