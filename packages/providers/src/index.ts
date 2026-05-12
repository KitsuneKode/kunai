import type { CoreProviderModule } from "@kunai/core";
import type { ProviderId } from "@kunai/types";

export * from "./allmanga/api-client";
export * from "./allmanga/direct";
export * from "./allmanga/manifest";
export * from "./miruro/direct";
export * from "./miruro/manifest";
export * from "./research";
export * from "./rivestream/direct";
export * from "./rivestream/manifest";
export * from "./shared";
export * from "./vidking";
export * from "./vidking/manifest";

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
