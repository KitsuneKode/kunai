import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import type { ProviderPriorityInput } from "@kunai/core";

export function createProviderPrioritySnapshot(config: KitsuneConfig): ProviderPriorityInput {
  return {
    providerPriority: [config.provider, ...config.providerPriority],
    animeProviderPriority: [config.animeProvider, ...config.animeProviderPriority],
    youtubeProviderPriority: [config.youtubeProvider, ...config.youtubeProviderPriority],
  };
}

function normalizeDisabledId(id: string): string {
  return id.trim().toLowerCase();
}

/** True when the provider id is not on the user's disabled list. */
export function isProviderEnabled(
  disabledProviders: readonly string[] | undefined,
  providerId: string,
): boolean {
  if (!disabledProviders || disabledProviders.length === 0) return true;
  const normalized = normalizeDisabledId(providerId);
  return !disabledProviders.some((entry) => normalizeDisabledId(entry) === normalized);
}
