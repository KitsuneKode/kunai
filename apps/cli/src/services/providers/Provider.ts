// =============================================================================
// Provider Interface (Domain)
//
// The contract that all providers must implement.
// =============================================================================

import type {
  TitleInfo,
  EpisodeInfo,
  EpisodePickerOption,
  StreamInfo,
  ProviderMetadata,
  ProviderCapabilities,
} from "@/domain/types";
import type { CoreProviderManifest } from "@kunai/core";

export interface StreamRequest {
  title: TitleInfo;
  episode?: EpisodeInfo;
  subLang: string;
  /** When set, overrides session config for this resolve (cache keys should match). */
  animeLang?: "sub" | "dub";
}

export interface EpisodeListRequest {
  title: TitleInfo;
}

export interface ProviderDeps {
  logger: import("@/infra/logger/Logger").Logger;
  tracer: import("@/infra/tracer/Tracer").Tracer;
  config: import("@/services/persistence/ConfigService").ConfigService;
}

export interface Provider {
  readonly metadata: ProviderMetadata;
  readonly capabilities: ProviderCapabilities;

  // Check if this provider can handle this title (fast, no network)
  canHandle(title: TitleInfo): boolean;

  // Resolve stream (may involve network, scraping, etc.)
  resolveStream(request: StreamRequest, signal?: AbortSignal): Promise<StreamInfo | null>;

  // Optional richer episode catalog for providers that can expose one.
  listEpisodes?(
    request: EpisodeListRequest,
    signal?: AbortSignal,
  ): Promise<EpisodePickerOption[] | null>;

  // Optional search capability for providers that expose a search API (e.g. anime).
  search?(
    query: string,
    opts: { animeLang: "sub" | "dub" },
    signal?: AbortSignal,
  ): Promise<import("@/domain/types").SearchResult[] | null>;
}

// Factory function type for creating providers
export type ProviderFactory = (deps: ProviderDeps) => Provider;

// Definition for registration
export interface ProviderDefinition {
  readonly id: string;
  readonly manifest: CoreProviderManifest;
  readonly factory: ProviderFactory;
}
