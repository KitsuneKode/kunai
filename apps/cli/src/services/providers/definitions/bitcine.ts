// =============================================================================
// BitCine Provider Adapter
// =============================================================================

import type { ProviderCapabilities, ProviderMetadata, StreamInfo, TitleInfo } from "@/domain/types";
import { bitcineManifest, buildBitcineEmbedUrl } from "@kunai/core";

import {
  attachProviderResolveResult,
  manifestToProviderCapabilities,
  manifestToProviderMetadata,
} from "../core-manifest-adapter";
import type { Provider, ProviderDeps, StreamRequest } from "../Provider";

export class BitCineProvider implements Provider {
  readonly metadata: ProviderMetadata = manifestToProviderMetadata(bitcineManifest);

  readonly capabilities: ProviderCapabilities = manifestToProviderCapabilities(bitcineManifest);

  constructor(private deps: ProviderDeps) {}

  canHandle(title: TitleInfo): boolean {
    return title.type === "movie" || title.type === "series";
  }

  async resolveStream(request: StreamRequest, signal?: AbortSignal): Promise<StreamInfo | null> {
    const url = buildBitcineEmbedUrl({
      id: request.title.id,
      mediaKind: request.title.type,
      season: request.episode?.season,
      episode: request.episode?.episode,
    });

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
