// =============================================================================
// Cineby Provider Adapter
// =============================================================================

import { Cineby as LegacyCineby } from "../../../providers/cineby";
import type { Provider, ProviderDeps, StreamRequest } from "../Provider";
import type { TitleInfo, StreamInfo, ProviderMetadata, ProviderCapabilities } from "../../../domain/types";

export class CinebyProvider implements Provider {
  readonly metadata: ProviderMetadata = {
    id: "cineby",
    name: "Cineby",
    description: "Cineby",
    recommended: false,
    isAnimeProvider: false,
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
        ? LegacyCineby.movieUrl(request.title.id)
        : LegacyCineby.seriesUrl(
            request.title.id,
            request.episode!.season,
            request.episode!.episode,
          );

    return this.deps.browser.scrape({
      url,
      needsClick: LegacyCineby.needsClick,
      signal,
    });
  }
}

export function createCinebyProvider(deps: ProviderDeps): Provider {
  return new CinebyProvider(deps);
}
