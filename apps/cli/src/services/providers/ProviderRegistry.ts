// =============================================================================
// Provider Registry
//
// Manages provider registration and resolution.
// =============================================================================

import type { TitleInfo, ProviderMetadata } from "@/domain/types";

import type { Provider, ProviderDefinition, ProviderDeps } from "./Provider";

export interface ProviderRegistry {
  get(id: string): Provider | undefined;
  getAll(): Provider[];
  getAllIds(): string[];
  getCompatible(title: TitleInfo): Provider[];
  getDefault(isAnime: boolean): Provider;
  getMetadata(id: string): ProviderMetadata | undefined;
}

export interface ProviderRegistryDeps extends Omit<ProviderDeps, "playerDomains"> {}

export class ProviderRegistryImpl implements ProviderRegistry {
  private providers = new Map<string, Provider>();
  private definitions = new Map<string, ProviderDefinition>();

  constructor(deps: ProviderRegistryDeps, definitions: ProviderDefinition[]) {
    // Calculate global player domains
    const playerDomains = Array.from(
      new Set(definitions.map((d) => d.metadata.domain).filter((d): d is string => !!d)),
    );

    // Instantiate all providers
    for (const def of definitions) {
      const instance = def.factory({ ...deps, playerDomains });
      this.providers.set(def.id, instance);
      this.definitions.set(def.id, def);
    }
  }

  get(id: string): Provider | undefined {
    return this.providers.get(id);
  }

  getAll(): Provider[] {
    return Array.from(this.providers.values());
  }

  getAllIds(): string[] {
    return Array.from(this.providers.keys());
  }

  getCompatible(title: TitleInfo): Provider[] {
    return this.getAll().filter((p) => p.canHandle(title));
  }

  getDefault(isAnime: boolean): Provider {
    const preferred = isAnime ? this.get("allanime") : this.get("vidking");

    if (preferred) return preferred;

    // Fallback to any provider with matching capability
    const fallback = this.getAll().find((p) =>
      isAnime ? p.metadata.isAnimeProvider : !p.metadata.isAnimeProvider,
    );

    if (!fallback) {
      throw new Error(`No providers available for mode: ${isAnime ? "anime" : "series"}`);
    }

    return fallback;
  }

  getMetadata(id: string): ProviderMetadata | undefined {
    return this.definitions.get(id)?.metadata;
  }
}
