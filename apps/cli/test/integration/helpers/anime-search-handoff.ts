import { titleInfoFromSearchResult } from "@/app/bootstrap/title-info";
import { mapAnimeDiscoveryResultToProviderNative } from "@/app/discover/anime-provider-mapping";
import { chooseSearchResultTitle } from "@/app/search/browse-option-mappers";
import type { Container } from "@/container";
import type { SearchResult, TitleInfo } from "@/domain/types";
import type { StreamRequest } from "@/services/providers/Provider";
import { streamRequestToResolveInput } from "@/services/providers/stream-request-adapter";
import { resolveProviderCatalogIdentity } from "@kunai/core";
import type { searchAllManga } from "@kunai/providers";
import type { ProviderResolveInput } from "@kunai/types";

/** Mirrors SearchPhase / workflows: AniList pick → provider mapping → TitleInfo for playback. */
export async function handoffAniListSearchPick(
  container: Container,
  options: {
    readonly discovery: SearchResult;
    readonly providerId: string;
    readonly episode?: {
      readonly season: number;
      readonly episode: number;
      readonly absoluteEpisode?: number;
    };
    readonly searchProviderNative?: typeof searchAllManga;
    readonly signal?: AbortSignal;
  },
): Promise<{
  readonly mapped: SearchResult;
  readonly title: TitleInfo;
  readonly request: StreamRequest;
  readonly resolveInput: ProviderResolveInput;
}> {
  const mapped = await mapAnimeDiscoveryResultToProviderNative(options.discovery, {
    mode: "anime",
    providerId: options.providerId,
    animeLanguageProfile: container.config.animeLanguageProfile,
    providerRegistry: container.providerRegistry,
    searchProviderNative: options.searchProviderNative,
    signal: options.signal,
  });

  const title = titleInfoFromSearchResult(
    mapped,
    chooseSearchResultTitle(mapped, container.config.animeTitlePreference),
  );

  const request: StreamRequest = {
    title,
    episode: options.episode ?? { season: 1, episode: 1 },
    audioPreference: container.config.animeLanguageProfile.audio,
    subtitlePreference: container.config.animeLanguageProfile.subtitle,
  };

  // Mirror production: resolve input carries the selected provider's manifest
  // catalog identity and provider id, not an untyped default.
  const manifest = container.providerRegistry.getManifest(options.providerId);
  if (!manifest) {
    throw new Error(`Missing provider manifest: ${options.providerId}`);
  }

  return {
    mapped,
    title,
    request,
    resolveInput: streamRequestToResolveInput(
      request,
      "anime",
      "play",
      resolveProviderCatalogIdentity(manifest),
      options.providerId,
    ),
  };
}
