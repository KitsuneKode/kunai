import type { ShellMode } from "@/domain/types";
import type { KitsuneConfig, MediaLanguageProfile } from "@/services/persistence/ConfigService";
import { shellModeToDefaultProviderKey } from "@/services/providers/provider-lane";

export function providerForLane(config: KitsuneConfig, mode: ShellMode): string {
  const key = shellModeToDefaultProviderKey(mode);
  if (key === "youtube") return config.youtubeProvider;
  if (key === "anime") return config.animeProvider;
  return config.provider;
}

export function languageProfileForLane(
  config: KitsuneConfig,
  mode: ShellMode,
): MediaLanguageProfile {
  if (mode === "youtube") return config.youtubeLanguageProfile;
  if (mode === "anime") return config.animeLanguageProfile;
  return config.seriesLanguageProfile;
}
