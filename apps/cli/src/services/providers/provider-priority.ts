import { isProviderEnabled } from "@/domain/provider/provider-switches";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import type { CoreProviderModule, ProviderPriorityInput } from "@kunai/core";

export function createProviderPrioritySnapshot(config: KitsuneConfig): ProviderPriorityInput {
  return {
    providerPriority: [config.provider, ...config.providerPriority],
    animeProviderPriority: [config.animeProvider, ...config.animeProviderPriority],
    youtubeProviderPriority: [config.youtubeProvider, ...config.youtubeProviderPriority],
  };
}

/** Resolve admission shares the same manual-exclusion policy as catalog readers. */
export function filterEnabledProviderModules(
  modules: readonly CoreProviderModule[],
  disabledProviders: readonly string[],
): readonly CoreProviderModule[] {
  return modules.filter((module) => isProviderEnabled(disabledProviders, module.providerId));
}
