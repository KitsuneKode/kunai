// =============================================================================
// BitCine Provider Adapter
// =============================================================================

import type { ProviderCapabilities, ProviderMetadata, StreamInfo, TitleInfo } from "@/domain/types";
import { bitcineManifest } from "@kunai/core";

import type { Provider, ProviderDeps, StreamRequest } from "../Provider";
import {
  attachProviderResolveResult,
  manifestToProviderCapabilities,
  manifestToProviderMetadata,
} from "../core-manifest-adapter";

export class BitCineProvider implements Provider {
  readonly metadata: ProviderMetadata = manifestToProviderMetadata(bitcineManifest);

  readonly capabilities: ProviderCapabilities = manifestToProviderCapabilities(bitcineManifest);

  constructor(private deps: ProviderDeps) {}

  canHandle(title: TitleInfo): boolean {
    return title.type === "movie" || title.type === "series";
  }

  async resolveStream(request: StreamRequest, signal?: AbortSignal): Promise<StreamInfo | null> {
    const url =
      request.title.type === "movie"
        ? `https://www.bitcine.net/movie/${request.title.id}?play=true`
        : `https://www.bitcine.net/tv/${request.title.id}/${request.episode!.season}/${request.episode!.episode}?play=true`;

    const stream = await this.deps.browser.scrape({
      url,
      needsClick: true,
      subLang: request.subLang,
      signal,
      tmdbId: request.title.id,
      titleType: request.title.type,
      season: request.episode?.season,
      episode: request.episode?.episode,
      playerDomains: this.deps.playerDomains,
    });

    return stream
      ? attachProviderResolveResult({
          manifest: bitcineManifest,
          request,
          stream,
          mode: "series",
          runtime: "playwright-lease",
        })
      : null;
  }
}

export function createBitCineProvider(deps: ProviderDeps): Provider {
  return new BitCineProvider(deps);
}
