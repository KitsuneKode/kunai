import type { CoreProviderModule } from "@kunai/core";
import type { ProviderId } from "@kunai/types";

export * from "./allmanga";
export * from "./research";
export * from "./vidking";

export interface ProviderModuleRegistry {
  readonly modules: readonly CoreProviderModule[];
  get(providerId: ProviderId): CoreProviderModule | undefined;
}

export function createProviderModuleRegistry(
  modules: readonly CoreProviderModule[] = [],
): ProviderModuleRegistry {
  const byId = new Map<ProviderId, CoreProviderModule>();

  for (const module of modules) {
    if (byId.has(module.providerId)) {
      throw new Error(`Duplicate provider module id: ${module.providerId}`);
    }
    byId.set(module.providerId, module);
  }

  return {
    modules,
    get(providerId) {
      return byId.get(providerId);
    },
  };
}
