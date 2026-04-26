// =============================================================================
// CinebyAnime Provider Adapter
// =============================================================================

import { CinebyAnime as LegacyCinebyAnime } from "@/providers/cineby-anime";
import type { StreamData } from "@/scraper";
import type {
  ProviderCapabilities,
  ProviderMetadata,
  StreamInfo,
  SubtitleTrack,
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
  };

  readonly capabilities: ProviderCapabilities = {
    contentTypes: ["series"],
  };

  constructor(private deps: ProviderDeps) {}

  canHandle(title: TitleInfo): boolean {
    return title.type === "series";
  }

  async resolveStream(request: StreamRequest, signal?: AbortSignal): Promise<StreamInfo | null> {
    const legacyOpts = {
      subLang: request.subLang,
      animeLang: this.deps.config.animeLang,
      embedScraper: (embedUrl: string) =>
        this.deps.browser.scrape({
          url: embedUrl,
          subLang: request.subLang,
          signal,
        }) as Promise<StreamData | null>,
    };

    const result = await LegacyCinebyAnime.resolveStream(
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
      subtitleList: result.subtitleList as SubtitleTrack[] | undefined,
      subtitleSource: result.subtitleSource,
      subtitleEvidence: result.subtitleEvidence,
      timestamp: result.timestamp,
    };
  }
}

export function createCinebyAnimeProvider(deps: ProviderDeps): Provider {
  return new CinebyAnimeProvider(deps);
}
