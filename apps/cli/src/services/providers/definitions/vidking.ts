// =============================================================================
// VidKing Provider Adapter
// =============================================================================

import type { ProviderCapabilities, ProviderMetadata, StreamInfo, TitleInfo } from "@/domain/types";
import type { Provider, ProviderDeps, StreamRequest } from "../Provider";

export class VidKingProvider implements Provider {
  readonly metadata: ProviderMetadata = {
    id: "vidking",
    name: "VidKing",
    description: "VidKing (recommended)",
    recommended: true,
    isAnimeProvider: false,
    domain: "vidking.net",
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
        ? `https://www.vidking.net/embed/movie/${request.title.id}?autoPlay=true`
        : `https://www.vidking.net/embed/tv/${request.title.id}/${request.episode!.season}/${request.episode!.episode}?autoPlay=true&episodeSelector=false&nextEpisode=false`;

    return this.deps.browser.scrape({
      url,
      needsClick: false, // autoPlay=true handles it
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

// Factory for registry
export function createVidKingProvider(deps: ProviderDeps): Provider {
  return new VidKingProvider(deps);
}
