// =============================================================================
// Cineby Provider Adapter
// =============================================================================

import type { ProviderCapabilities, ProviderMetadata, StreamInfo, TitleInfo } from "@/domain/types";
import type { Provider, ProviderDeps, StreamRequest } from "../Provider";

export class CinebyProvider implements Provider {
  readonly metadata: ProviderMetadata = {
    id: "cineby",
    name: "Cineby",
    description: "Cineby",
    recommended: false,
    isAnimeProvider: false,
    domain: "cineby.sc",
  };

  readonly capabilities: ProviderCapabilities = {
    contentTypes: ["movie", "series"],
  };

  constructor(private deps: ProviderDeps) {}

  canHandle(title: TitleInfo): boolean {
    return title.type === "movie" || title.type === "series";
  }

  async resolveStream(request: StreamRequest, signal?: AbortSignal): Promise<StreamInfo | null> {
    const url =
      request.title.type === "movie"
        ? `https://www.cineby.sc/movie/${request.title.id}?play=true`
        : `https://www.cineby.sc/tv/${request.title.id}/${request.episode!.season}/${request.episode!.episode}?play=true`;

    return this.deps.browser.scrape({
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
  }
}

export function createCinebyProvider(deps: ProviderDeps): Provider {
  return new CinebyProvider(deps);
}
