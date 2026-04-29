// =============================================================================
// CinebyAnime Provider Adapter
// =============================================================================

import type { ProviderCapabilities, ProviderMetadata, StreamInfo, TitleInfo } from "@/domain/types";
import { cinebyAnimeManifest } from "@kunai/core";

import type { Provider, ProviderDeps, StreamRequest } from "../Provider";
import {
  manifestToProviderCapabilities,
  manifestToProviderMetadata,
} from "../core-manifest-adapter";

export class CinebyAnimeProvider implements Provider {
  readonly metadata: ProviderMetadata = manifestToProviderMetadata(cinebyAnimeManifest);

  readonly capabilities: ProviderCapabilities = manifestToProviderCapabilities(cinebyAnimeManifest);

  constructor(private deps: ProviderDeps) {}

  canHandle(title: TitleInfo): boolean {
    return title.type === "series";
  }

  async resolveStream(request: StreamRequest, signal?: AbortSignal): Promise<StreamInfo | null> {
    const url = `https://www.cineby.sc/anime/${request.title.id}?episode=${request.episode?.episode ?? 1}&play=true`;

    return this.deps.browser.scrape({
      url,
      needsClick: true,
      subLang: request.subLang,
      signal,
      playerDomains: this.deps.playerDomains,
      tmdbId: request.title.id,
      titleType: request.title.type,
      season: request.episode?.season,
      episode: request.episode?.episode,
    });
  }
}

export function createCinebyAnimeProvider(deps: ProviderDeps): Provider {
  return new CinebyAnimeProvider(deps);
}
