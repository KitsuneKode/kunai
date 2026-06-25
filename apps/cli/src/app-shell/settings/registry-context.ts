import type { Container } from "@/container";
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
    label: provider.id === currentProvider ? `${provider.name}  ·  current` : provider.name,
    detail: provider.description,
  }));
}

export function buildSettingsRegistryContext(
  container: Container,
  config: KitsuneConfig,
): SettingsRegistryContext {
  const seriesProviderMetadata = sortProvidersByConfigPriority({
    providers: container.providerRegistry
      .getAll()
      .map((provider) => provider.metadata)
      .filter((metadata) => !metadata.isAnimeProvider && !metadata.isYoutubeProvider),
    priority: [config.provider, ...config.providerPriority],
  });
  const animeProviderMetadata = sortProvidersByConfigPriority({
    providers: container.providerRegistry
      .getAll()
      .map((provider) => provider.metadata)
      .filter((metadata) => metadata.isAnimeProvider),
    priority: [config.animeProvider, ...config.animeProviderPriority],
  });
  const youtubeProviderMetadata = sortProvidersByConfigPriority({
    providers: container.providerRegistry
      .getAll()
      .map((provider) => provider.metadata)
      .filter((metadata) => metadata.isYoutubeProvider),
    priority: [config.youtubeProvider, ...config.youtubeProviderPriority],
  });

  return {
    config,
    presenceSnapshot: container.presence.getSnapshot(),
    seriesProviderOptions: buildSettingsProviderOptions({
      providers: seriesProviderMetadata,
      currentProvider: config.provider,
    }),
    animeProviderOptions: buildSettingsProviderOptions({
      providers: animeProviderMetadata,
      currentProvider: config.animeProvider,
    }),
    youtubeProviderOptions: buildSettingsProviderOptions({
      providers: youtubeProviderMetadata,
      currentProvider: config.youtubeProvider,
    }),
    container,
  };
}
