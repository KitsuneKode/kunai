// =============================================================================
// AllAnime Provider Adapter
// =============================================================================

import { AllAnime as LegacyAllAnime } from "../../../providers/allanime";
import type { Provider, ProviderDeps, StreamRequest } from "../Provider";
import type {
  TitleInfo,
  StreamInfo,
  ProviderMetadata,
  ProviderCapabilities,
} from "../../../domain/types";

export class AllAnimeProvider implements Provider {
  readonly metadata: ProviderMetadata = {
    id: "allanime",
    name: "AllAnime",
    description: "AllAnime / AllManga (anime, sub & dub, no browser needed)",
    recommended: false,
    isAnimeProvider: true,
  };

  readonly capabilities: ProviderCapabilities = {
    contentTypes: ["series"], // Anime is always series
  };

  constructor(private deps: ProviderDeps) {}

  canHandle(title: TitleInfo): boolean {
    // AllAnime only handles anime (series type with anime provider flag)
    return title.type === "series";
  }

  async resolveStream(
    request: StreamRequest,
    signal?: AbortSignal,
  ): Promise<StreamInfo | null> {
    const legacyOpts = {
      subLang: request.subLang,
      animeLang: this.deps.config.animeLang,
      embedScraper: (embedUrl: string) =>
        this.deps.browser.scrape({ url: embedUrl, signal }) as Promise<
          import("../../../scraper").StreamData | null
        >,
    };

    const result = await LegacyAllAnime.resolveStream(
      request.title.id,
      request.title.type,
      request.episode?.season ?? 1,
      request.episode?.episode ?? 1,
      legacyOpts,
    );

    if (!result) return null;

    return {
      url: result.url,
      headers: result.headers,
      subtitle: result.subtitle ?? undefined,
      subtitleList: result.subtitleList as
        | import("../../../domain/types").SubtitleTrack[]
        | undefined,
      timestamp: result.timestamp,
    };
  }
}

export function createAllAnimeProvider(deps: ProviderDeps): Provider {
  return new AllAnimeProvider(deps);
}
