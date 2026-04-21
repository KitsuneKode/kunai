// =============================================================================
// Braflix Provider Adapter
// =============================================================================

import {
  Braflix as LegacyBraflix,
  braflixSearch,
} from "../../../providers/braflix";
import type { Provider, ProviderDeps, StreamRequest } from "../Provider";
import type {
  TitleInfo,
  StreamInfo,
  ProviderMetadata,
  ProviderCapabilities,
} from "../../../domain/types";

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

  async resolveStream(
    request: StreamRequest,
    signal?: AbortSignal,
  ): Promise<StreamInfo | null> {
    // Braflix needs embedScraper for the final step - delegate to browser
    const legacyOpts = {
      subLang: request.subLang,
      animeLang: "sub" as const,
      embedScraper: (embedUrl: string) =>
        this.deps.browser.scrape({ url: embedUrl, signal }) as Promise<
          import("../../../scraper").StreamData | null
        >,
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
      subtitleList: result.subtitleList as
        | import("../../../domain/types").SubtitleTrack[]
        | undefined,
      timestamp: result.timestamp,
    };
  }
}

export function createBraflixProvider(deps: ProviderDeps): Provider {
  return new BraflixProvider(deps);
}
