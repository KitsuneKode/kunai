// =============================================================================
// Braflix Provider Adapter
// =============================================================================

import { Braflix as LegacyBraflix } from "@/providers/braflix";
import type { StreamData } from "@/scraper";
import type {
  ProviderCapabilities,
  ProviderMetadata,
  StreamInfo,
  SubtitleTrack,
  TitleInfo,
} from "@/domain/types";

import type { Provider, ProviderDeps, StreamRequest } from "../Provider";

export class BraflixProvider implements Provider {
  readonly metadata: ProviderMetadata = {
    id: "braflix",
    name: "Braflix",
    description: "Braflix (braflix.mov, no browser for metadata)",
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
    // Braflix needs embedScraper for the final step - delegate to browser
    const legacyOpts = {
      subLang: request.subLang,
      animeLang: "sub" as const,
      embedScraper: (embedUrl: string) =>
        this.deps.browser.scrape({
          url: embedUrl,
          subLang: request.subLang,
          signal,
        }) as Promise<StreamData | null>,
    };

    const result = await LegacyBraflix.resolveStream(
      request.title.id,
      request.title.type,
      request.episode?.season ?? 1,
      request.episode?.episode ?? 1,
      legacyOpts,
    );

    if (!result) return null;

    // Map legacy StreamData to new StreamInfo
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

export function createBraflixProvider(deps: ProviderDeps): Provider {
  return new BraflixProvider(deps);
}
