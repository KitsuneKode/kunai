// =============================================================================
// CinebyAnime Provider Adapter
// =============================================================================

import type {
  ProviderCapabilities,
  ProviderMetadata,
  StreamInfo,
  TitleInfo,
} from "@/domain/types";

import type { Provider, ProviderDeps, StreamRequest } from "../Provider";

export class CinebyAnimeProvider implements Provider {
  readonly metadata: ProviderMetadata = {
    id: "cineby-anime",
    name: "Cineby Anime",
    description: "Cineby Anime (HiAnime via anime-db.videasy.net)",
    recommended: false,
    isAnimeProvider: true,
    domain: "cineby.sc",
  };

  readonly capabilities: ProviderCapabilities = {
    contentTypes: ["series"],
  };

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
