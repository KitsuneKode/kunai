// =============================================================================
// VidKing Provider Adapter
//
// Wraps the legacy Playwright provider into the new Provider interface.
// =============================================================================

import { VidKing as LegacyVidKing } from "../../../providers/vidking";
import type { Provider, ProviderDeps, StreamRequest } from "../Provider";
import type { TitleInfo, StreamInfo, ProviderMetadata, ProviderCapabilities } from "../../../domain/types";

export class VidKingProvider implements Provider {
  readonly metadata: ProviderMetadata = {
    id: "vidking",
    name: "VidKing",
    description: "VidKing (recommended)",
    recommended: true,
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
        ? LegacyVidKing.movieUrl(request.title.id)
        : LegacyVidKing.seriesUrl(
            request.title.id,
            request.episode!.season,
            request.episode!.episode,
          );

    return this.deps.browser.scrape({
      url,
      needsClick: LegacyVidKing.needsClick,
      signal,
    });
  }
}

// Factory for registry
export function createVidKingProvider(deps: ProviderDeps): Provider {
  return new VidKingProvider(deps);
}
