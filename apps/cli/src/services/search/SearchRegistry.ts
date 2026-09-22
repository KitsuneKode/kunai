// =============================================================================
// Search Registry
//
// Manages search service registration and resolution.
// =============================================================================

import type { ProviderCatalogIdentity } from "@kunai/core";

import type { SearchService, SearchServiceDefinition, SearchDeps } from "./SearchService";

export interface SearchRegistry {
  get(id: string): SearchService | undefined;
  getAll(): SearchService[];
  getAllIds(): string[];
  getForProvider(
    providerId: string,
    catalogIdentity?: ProviderCatalogIdentity,
  ): SearchService | undefined;
  getDefault(): SearchService;
}

export interface SearchRegistryDeps extends SearchDeps {}

export class SearchRegistryImpl implements SearchRegistry {
  private services = new Map<string, SearchService>();
  private definitions = new Map<string, SearchServiceDefinition>();

  constructor(deps: SearchRegistryDeps, definitions: SearchServiceDefinition[]) {
    for (const def of definitions) {
      const instance = def.factory(deps);
      this.services.set(def.id, instance);
      this.definitions.set(def.id, def);
    }
  }

  get(id: string): SearchService | undefined {
    return this.services.get(id);
  }

  getAll(): SearchService[] {
    return Array.from(this.services.values());
  }

  getAllIds(): string[] {
    return Array.from(this.services.keys());
  }

  getForProvider(
    providerId: string,
    catalogIdentity?: ProviderCatalogIdentity,
  ): SearchService | undefined {
    // The explicit list wins — it is the deliberate override for providers whose
    // catalog identity differs from the catalog they still consume (a
    // provider-native adapter borrowing AniList's filtered search).
    for (const [id, def] of this.definitions) {
      if (def.compatibleProviders.includes(providerId)) {
        return this.services.get(id);
      }
    }
    // Otherwise the provider's declared catalog identity picks the service —
    // any provider resolving TMDB ids gets the TMDB catalog without list
    // maintenance.
    if (catalogIdentity) {
      for (const [id, def] of this.definitions) {
        if (def.servesCatalog === catalogIdentity) {
          return this.services.get(id);
        }
      }
    }
    return undefined;
  }

  getDefault(): SearchService {
    // Default to TMDB service
    const tmdb = this.get("tmdb");
    if (tmdb) return tmdb;

    const first = this.getAll()[0];
    if (!first) {
      throw new Error("No search services available");
    }
    return first;
  }
}
