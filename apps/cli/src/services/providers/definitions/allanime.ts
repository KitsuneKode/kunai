// =============================================================================
// AllAnime Provider Adapter
// =============================================================================

import type {
  EpisodePickerOption,
  ProviderCapabilities,
  ProviderMetadata,
  StreamInfo,
  SubtitleTrack,
  TitleInfo,
} from "@/domain/types";
import type { StreamData } from "@/scraper";
import { allanimeManifest } from "@kunai/core";
import { createAnimeProvider, fetchAnimeEpisodeCatalog } from "./allanime-family";

import type { Provider, ProviderDeps, StreamRequest } from "../Provider";
import {
  manifestToProviderCapabilities,
  manifestToProviderMetadata,
} from "../core-manifest-adapter";

const ALLANIME_CONFIG = {
  id: allanimeManifest.id,
  name: allanimeManifest.displayName,
  description: allanimeManifest.description,
  domain: allanimeManifest.domain,
  apiUrl: "https://api.allanime.day/api",
  referer: "https://youtu-chan.com",
  recommended: allanimeManifest.recommended,
  isAnimeProvider: true,
};

export class AllAnimeProvider implements Provider {
  readonly metadata: ProviderMetadata = manifestToProviderMetadata(allanimeManifest);

  readonly capabilities: ProviderCapabilities = manifestToProviderCapabilities(allanimeManifest);

  private legacyProvider = createAnimeProvider(ALLANIME_CONFIG);

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

    const result = await this.legacyProvider.resolveStream(
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

  async listEpisodes(
    request: { title: TitleInfo },
    _signal?: AbortSignal,
  ): Promise<EpisodePickerOption[] | null> {
    return fetchAnimeEpisodeCatalog({
      apiUrl: ALLANIME_CONFIG.apiUrl,
      referer: "https://allmanga.to",
      ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
      showId: request.title.id,
      mode: this.deps.config.animeLang,
    });
  }

  async search(
    query: string,
    opts: { animeLang: "sub" | "dub" },
    _signal?: AbortSignal,
  ): Promise<import("@/domain/types").SearchResult[] | null> {
    const results = await this.legacyProvider.search(query, opts);
    if (!results) return null;

    return results.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      year: r.year ?? "",
      overview: "",
      posterPath: r.posterUrl ?? null,
      rating: null,
      popularity: null,
      episodeCount: r.epCount,
    }));
  }
}

export function createAllAnimeProvider(deps: ProviderDeps): Provider {
  return new AllAnimeProvider(deps);
}
