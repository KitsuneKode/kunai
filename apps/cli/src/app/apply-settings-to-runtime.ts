import type { Container } from "@/container";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

export async function applySettingsToRuntime({
  container,
  next,
  previous,
}: {
  readonly container: Container;
  readonly next: KitsuneConfig;
  readonly previous?: KitsuneConfig;
}): Promise<void> {
  const { stateManager, config } = container;
  const before = previous ?? config.getRaw();

  await config.update(next);
  await config.save();

  container.providerRegistry.setPriority({
    providerPriority: [next.provider, ...next.providerPriority],
    animeProviderPriority: [next.animeProvider, ...next.animeProviderPriority],
  });

  const state = stateManager.getState();
  stateManager.dispatch({
    type: "SET_DEFAULT_PROVIDER",
    mode: "series",
    provider: next.provider,
  });
  stateManager.dispatch({
    type: "SET_DEFAULT_PROVIDER",
    mode: "anime",
    provider: next.animeProvider,
  });
  stateManager.dispatch({
    type: "UPDATE_LANGUAGE_PROFILE",
    kind: "anime",
    profile: next.animeLanguageProfile,
  });
  stateManager.dispatch({
    type: "UPDATE_LANGUAGE_PROFILE",
    kind: "series",
    profile: next.seriesLanguageProfile,
  });
  stateManager.dispatch({
    type: "UPDATE_LANGUAGE_PROFILE",
    kind: "movie",
    profile: next.movieLanguageProfile,
  });

  const currentProvider =
    state.mode === "anime" ? state.defaultProviders.anime : state.defaultProviders.series;
  const nextDefault = state.mode === "anime" ? next.animeProvider : next.provider;
  if (state.provider === currentProvider && state.provider !== nextDefault) {
    stateManager.dispatch({
      type: "SET_PROVIDER",
      provider: nextDefault,
    });
  }

  if (state.mode === before.defaultMode && state.mode !== next.defaultMode) {
    stateManager.dispatch({
      type: "SET_MODE",
      mode: next.defaultMode,
      provider: next.defaultMode === "anime" ? next.animeProvider : next.provider,
    });
  }

  if (
    before.presenceProvider !== next.presenceProvider ||
    before.presenceDiscordClientId !== next.presenceDiscordClientId ||
    before.presenceDiscordOpenUrl !== next.presenceDiscordOpenUrl
  ) {
    await container.presence.disconnect("settings-changed");
  }

  if (before.videasyAppId !== next.videasyAppId) {
    await invalidateVideasyCaches(container, before, next);
  }
}

async function invalidateVideasyCaches(
  container: Container,
  before: KitsuneConfig,
  next: KitsuneConfig,
): Promise<void> {
  const { invalidateVideasyProviderCaches } = await import("@/app/videasy-cache-invalidation");
  await invalidateVideasyProviderCaches({
    cacheStore: container.cacheStore,
    sourceInventory: container.sourceInventory,
    diagnostics: container.diagnosticsService,
    reason: `videasyAppId changed ${before.videasyAppId} -> ${next.videasyAppId}`,
  });
}
