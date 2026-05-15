import type { EpisodeInfo, ShellMode, TitleInfo } from "@/domain/types";
import type { EpisodeIdentity, ProviderResolveInput, TitleIdentity } from "@kunai/types";

export interface StreamRequestLike {
  readonly title: TitleInfo;
  readonly episode?: EpisodeInfo;
  readonly audioPreference: string;
  readonly subtitlePreference: string;
}

export function streamRequestToResolveInput(
  request: StreamRequestLike,
  mode: ShellMode,
  intent: ProviderResolveInput["intent"] = "play",
): ProviderResolveInput {
  return {
    title: titleToCoreIdentity(request.title, mode),
    episode: episodeToCoreIdentity(request.episode),
    mediaKind: mode === "anime" ? "anime" : request.title.type,
    preferredAudioLanguage: mode === "anime" ? request.audioPreference : undefined,
    preferredSubtitleLanguage: request.subtitlePreference,
    preferredPresentation:
      mode === "anime" ? (request.audioPreference === "dub" ? "dub" : "sub") : "raw",
    preferredSubtitleDelivery: mode === "anime" ? "hardcoded" : "external",
    qualityPreference: undefined,
    intent,
    allowedRuntimes: ["direct-http"],
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
