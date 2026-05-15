// =============================================================================
// Search Service Interface (Domain)
//
// The contract that all search services must implement.
// =============================================================================

import type { SearchIntent } from "../../domain/search/SearchIntent";
import type { SearchResult, TitleInfo, SearchMetadata } from "../../domain/types";

export interface SearchDeps {
  logger: import("../../infra/logger/Logger").Logger;
  tracer: import("../../infra/tracer/Tracer").Tracer;
}

export interface SearchService {
  readonly metadata: SearchMetadata;
  readonly compatibleProviders: string[]; // Advisory coupling

  search(query: string, signal?: AbortSignal, intent?: SearchIntent): Promise<SearchResult[]>;
  getTitleDetails(id: string, signal?: AbortSignal): Promise<TitleInfo | null>;
}

// Factory function type
export type SearchFactory = (deps: SearchDeps) => SearchService;

// Definition for registration
export interface SearchServiceDefinition {
  readonly id: string;
  readonly metadata: SearchMetadata;
  readonly compatibleProviders: string[];
  readonly factory: SearchFactory;
}
