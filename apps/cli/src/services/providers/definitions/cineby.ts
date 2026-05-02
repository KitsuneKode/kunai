// =============================================================================
// Cineby Provider Adapter
// =============================================================================

import type { ProviderCapabilities, ProviderMetadata, StreamInfo, TitleInfo } from "@/domain/types";
import { buildCinebyEmbedUrl, cinebyManifest } from "@kunai/core";

import {
  attachProviderResolveResult,
  manifestToProviderCapabilities,
  manifestToProviderMetadata,
} from "../core-manifest-adapter";
import type { Provider, ProviderDeps, StreamRequest } from "../Provider";

export class CinebyProvider implements Provider {
  readonly metadata: ProviderMetadata = manifestToProviderMetadata(cinebyManifest);

  readonly capabilities: ProviderCapabilities = manifestToProviderCapabilities(cinebyManifest);

  constructor(private deps: ProviderDeps) {}

  canHandle(title: TitleInfo): boolean {
    return title.type === "movie" || title.type === "series";
  }

  async resolveStream(request: StreamRequest, signal?: AbortSignal): Promise<StreamInfo | null> {
    const url = buildCinebyEmbedUrl({
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
          manifest: cinebyManifest,
          request,
          stream,
          mode: "series",
          runtime: "playwright-lease",
        })
      : null;
  }
}

export function createCinebyProvider(deps: ProviderDeps): Provider {
  return new CinebyProvider(deps);
}
