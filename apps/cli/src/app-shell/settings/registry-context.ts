import type { Container } from "@/container";
import { markCurrentLabel } from "@/domain/current-label";
import { isStremioAddonProviderId, stremioAddonsEnabled } from "@/domain/provider/stremio-addons";
import type { ProviderMetadata } from "@/domain/types";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

import { sortProvidersByConfigPriority } from "../panel-data";
import type { ShellPickerOption } from "../types";
import type { SettingsRegistryContext } from "./types";

function buildSettingsProviderOptions({
  providers,
  currentProvider,
}: {
  providers: readonly ProviderMetadata[];
  currentProvider: string;
}): readonly ShellPickerOption<string>[] {
  return providers.map((provider) => ({
    value: provider.id,
    label: markCurrentLabel(provider.name, provider.id === currentProvider),
    detail: provider.description,
  }));
}

/**
 * The config as the live file records it for the two consent keys, over the
 * in-memory snapshot for everything else. A standalone `kunai addons
 * enable|disable` rewrites config.json under a running session — seeding a
 * draft or a writer from memory alone would resurrect the stale value.
 */
export function readSettingsConfig(container: Container): KitsuneConfig {
  return { ...container.config.getRaw(), ...container.config.readStremioAddonsConsent?.() };
}

export function buildSettingsRegistryContext(
  container: Container,
  config: KitsuneConfig,
): SettingsRegistryContext {
  // Settings lists every registered provider — including switched-off ones —
  // so a disable never hides its own re-enable switch.
  const seriesProviderMetadata = sortProvidersByConfigPriority({
    providers: container.providerRegistry
      .getAllRegistered()
      .map((provider) => provider.metadata)
      .filter((metadata) => !metadata.isAnimeProvider && !metadata.isYoutubeProvider),
    priority: [config.provider, ...config.providerPriority],
  });
  const animeProviderMetadata = sortProvidersByConfigPriority({
    providers: container.providerRegistry
      .getAllRegistered()
      .map((provider) => provider.metadata)
      .filter((metadata) => metadata.isAnimeProvider),
    priority: [config.animeProvider, ...config.animeProviderPriority],
  });
  const youtubeProviderMetadata = sortProvidersByConfigPriority({
    providers: container.providerRegistry
      .getAllRegistered()
      .map((provider) => provider.metadata)
      .filter((metadata) => metadata.isYoutubeProvider),
    priority: [config.youtubeProvider, ...config.youtubeProviderPriority],
  });

  // Provider pickers offer addons only while the draft has the experimental
  // feature on — a draft that turned it off must not keep offering them even
  // before it is persisted.
  const includeAddons = stremioAddonsEnabled(config);
  const offered = (providers: readonly ProviderMetadata[]) =>
    includeAddons
      ? providers
      : providers.filter((metadata) => !isStremioAddonProviderId(metadata.id));
  return {
    // `config` is the draft under edit — authoritative for render.
    config,
    persistedConfig: readSettingsConfig(container),
    presenceSnapshot: container.presence.getSnapshot(),
    seriesProviderOptions: buildSettingsProviderOptions({
      providers: offered(seriesProviderMetadata),
      currentProvider: config.provider,
    }),
    animeProviderOptions: buildSettingsProviderOptions({
      providers: offered(animeProviderMetadata),
      currentProvider: config.animeProvider,
    }),
    youtubeProviderOptions: buildSettingsProviderOptions({
      providers: offered(youtubeProviderMetadata),
      currentProvider: config.youtubeProvider,
    }),
    sync: {
      adapters: container.syncService.adapters,
      authAvailability: container.syncAuthAvailability,
      status: container.syncService.getStatus(config.sync.pausedUntil),
    },
    container,
  };
}
