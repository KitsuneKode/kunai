import type { Container } from "@/container";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { createProviderPrioritySnapshot } from "@/services/providers/provider-priority";

import { providerForLane } from "./lane-settings-sync";

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

  container.providerRegistry.setPriority(createProviderPrioritySnapshot(next));

  const state = stateManager.getState();
  for (const mode of ["series", "anime", "youtube"] as const) {
    stateManager.dispatch({
      type: "SET_DEFAULT_PROVIDER",
      mode,
      provider: providerForLane(next, mode),
    });
  }

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

  const beforeDefault = providerForLane(before, state.mode);
  const nextDefault = providerForLane(next, state.mode);
  // Changing the lane default updates the live session provider so
  // /settings → Providers (and /providers) take effect immediately.
  if (beforeDefault !== nextDefault) {
    stateManager.dispatch({
      type: "SET_PROVIDER",
      provider: nextDefault,
    });
  }

  if (state.mode === before.defaultMode && state.mode !== next.defaultMode) {
    stateManager.dispatch({
      type: "SET_MODE",
      mode: next.defaultMode,
      provider: providerForLane(next, next.defaultMode),
    });
  }

  if (before.offlineMode !== next.offlineMode) {
    container.connectivity.notifyIntentChanged();
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

  if (JSON.stringify(before.youtubeMetadata) !== JSON.stringify(next.youtubeMetadata)) {
    const { applyYoutubeProviderConfig } = await import("@/container/configure-youtube-provider");
    applyYoutubeProviderConfig(next, container.cacheDb, { purgeCache: true });
  }
}

async function invalidateVideasyCaches(
  container: Container,
  before: KitsuneConfig,
  next: KitsuneConfig,
): Promise<void> {
  const { invalidateVideasyProviderCaches } =
    await import("@/app/playback/videasy-cache-invalidation");
  await invalidateVideasyProviderCaches({
    cacheStore: container.cacheStore,
    sourceInventory: container.sourceInventory,
    diagnostics: container.diagnosticsService,
    reason: `videasyAppId changed ${before.videasyAppId} -> ${next.videasyAppId}`,
  });
}
