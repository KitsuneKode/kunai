import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import type { ProviderPriorityInput } from "@kunai/core";

export function createProviderPrioritySnapshot(config: KitsuneConfig): ProviderPriorityInput {
  return {
    providerPriority: [config.provider, ...config.providerPriority],
    animeProviderPriority: [config.animeProvider, ...config.animeProviderPriority],
  };
}
