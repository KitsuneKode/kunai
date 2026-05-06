import type {
  ContentType,
  EpisodeInfo,
  ProviderCapabilities,
  ProviderMetadata,
  ShellMode,
  StreamInfo,
  TitleInfo,
} from "@/domain/types";
import {
  adaptCliStreamResult,
  createProviderCachePolicy,
  type CoreProviderManifest,
} from "@kunai/core";
import type { EpisodeIdentity, ProviderRuntime, TitleIdentity } from "@kunai/types";

import type { StreamRequest } from "./Provider";

export function manifestToProviderMetadata(
  manifest: CoreProviderManifest,
  overrides: Partial<ProviderMetadata> = {},
): ProviderMetadata {
  return {
    id: manifest.id,
    name: manifest.displayName,
    aliases: manifest.aliases,
    description: manifest.description,
    recommended: manifest.recommended,
    isAnimeProvider: manifest.mediaKinds.includes("anime"),
    status: manifest.status,
    domain: manifest.domain,
    ...overrides,
  };
}

export function manifestToProviderCapabilities(
  manifest: CoreProviderManifest,
): ProviderCapabilities {
  return {
    contentTypes: manifest.mediaKinds.filter(isCliContentType),
  };
}

export function titleToCoreIdentity(title: TitleInfo, mode: ShellMode): TitleIdentity {
  const kind = mode === "anime" ? "anime" : title.type;

  return {
    id: title.id,
    kind,
    title: title.name,
    year: title.year ? Number.parseInt(title.year, 10) || undefined : undefined,
    tmdbId: kind === "anime" ? undefined : title.id,
    anilistId: kind === "anime" ? title.id : undefined,
  };
}

export function episodeToCoreIdentity(
  episode: EpisodeInfo | undefined,
): EpisodeIdentity | undefined {
  if (!episode) {
    return undefined;
  }

  return {
    season: episode.season,
    episode: episode.episode,
    title: episode.name,
    airDate: episode.airDate,
  };
}

export function attachProviderResolveResult({
  manifest,
  request,
  stream,
  mode,
  runtime,
}: {
  readonly manifest: CoreProviderManifest;
  readonly request: StreamRequest;
  readonly stream: StreamInfo;
  readonly mode: ShellMode;
  readonly runtime: ProviderRuntime;
}): StreamInfo {
  const title = titleToCoreIdentity(request.title, mode);
  const episode = episodeToCoreIdentity(request.episode);
  const cachePolicy = createProviderCachePolicy({
    providerId: manifest.id,
    title,
    episode,
    subtitleLanguage: request.subLang,
  });

  return {
    ...stream,
    providerResolveResult: adaptCliStreamResult({
      providerId: manifest.id,
      title,
      episode,
      stream,
      cachePolicy,
      runtime,
    }),
  };
}

function isCliContentType(kind: string): kind is ContentType {
  return kind === "movie" || kind === "series";
}
