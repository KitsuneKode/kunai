// =============================================================================
// BitCine Provider Adapter
// =============================================================================

import { BitCine as LegacyBitCine } from "../../../providers/bitcine";
import type { Provider, ProviderDeps, StreamRequest } from "../Provider";
import type { TitleInfo, StreamInfo, ProviderMetadata, ProviderCapabilities } from "../../../domain/types";

export class BitCineProvider implements Provider {
  readonly metadata: ProviderMetadata = {
    id: "bitcine",
    name: "BitCine",
    description: "BitCine (Cineby mirror)",
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
        ? LegacyBitCine.movieUrl(request.title.id)
        : LegacyBitCine.seriesUrl(
            request.title.id,
            request.episode!.season,
            request.episode!.episode,
          );

    return this.deps.browser.scrape({
      url,
      needsClick: LegacyBitCine.needsClick,
      signal,
    });
  }
}

export function createBitCineProvider(deps: ProviderDeps): Provider {
  return new BitCineProvider(deps);
}
