// =============================================================================
// Search Service Interface (Domain)
//
// The contract that all search services must implement.
// =============================================================================

import type { ProviderCatalogIdentity } from "@kunai/core";

import type { SearchIntent } from "../../domain/search/SearchIntent";
import type { SearchResult, TitleInfo, SearchMetadata } from "../../domain/types";

export interface SearchDeps {
  logger: import("../../infra/logger/Logger").Logger;
  tracer: import("../../infra/tracer/Tracer").Tracer;
}

/**
 * The catalog namespace a search service answers. Matching a provider's
 * `metadata.catalogIdentity` against this is the primary routing rule; the
 * explicit `compatibleProviders` list only carries deliberate overrides (a
 * provider-native provider that still consumes this catalog for filtered
 * search), so adding a new provider never requires editing a service list.
 */
export type ServedCatalog = Exclude<ProviderCatalogIdentity, "provider-native">;

export interface SearchService {
  readonly metadata: SearchMetadata;
  readonly servesCatalog?: ServedCatalog;
  readonly compatibleProviders: string[]; // Advisory coupling — explicit overrides only

  search(query: string, signal?: AbortSignal, intent?: SearchIntent): Promise<SearchResult[]>;
  getTitleDetails(id: string, signal?: AbortSignal): Promise<TitleInfo | null>;
}

// Factory function type
export type SearchFactory = (deps: SearchDeps) => SearchService;

// Definition for registration
export interface SearchServiceDefinition {
  readonly id: string;
  readonly metadata: SearchMetadata;
  readonly servesCatalog?: ServedCatalog;
  readonly compatibleProviders: string[];
  readonly factory: SearchFactory;
}
