import type { EpisodeInfo, ShellMode, TitleInfo } from "@/domain/types";
import { resolveProviderTitleIdentity, type ProviderCatalogIdentity } from "@kunai/core";
import { normalizeLegacyVideasySourceId, resolveAnimeAudioIntent } from "@kunai/providers";
import type {
  EpisodeIdentity,
  ProviderResolveInput,
  StartupPriority,
  TitleIdentity,
} from "@kunai/types";

export interface StreamRequestLike {
  readonly title: TitleInfo;
  readonly episode?: EpisodeInfo;
  readonly audioPreference: string;
  readonly subtitlePreference: string;
  readonly qualityPreference?: string;
  readonly startupPriority?: StartupPriority;
  readonly selectedSourceId?: string;
  readonly selectedStreamId?: string;
  readonly favoriteSourceNames?: readonly string[];
}

export function streamRequestToResolveInput(
  request: StreamRequestLike,
  mode: ShellMode,
  intent: ProviderResolveInput["intent"] = "play",
  catalogIdentity?: ProviderCatalogIdentity,
  providerId?: string,
): ProviderResolveInput {
  const animeAudioIntent =
    mode === "anime" ? resolveAnimeAudioIntent(request.audioPreference) : null;
  return {
    title: titleToCoreIdentity(request.title, mode, catalogIdentity, providerId),
    episode: episodeToCoreIdentity(request.episode),
    mediaKind: mode === "anime" ? "anime" : request.title.type,
    preferredSourceId: normalizeOptionalId(request.selectedSourceId),
    preferredStreamId: normalizeOptionalId(request.selectedStreamId),
    favoriteSourceNames:
      request.favoriteSourceNames && request.favoriteSourceNames.length > 0
        ? request.favoriteSourceNames
        : undefined,
    preferredAudioLanguage: animeAudioIntent?.preferredAudioLanguage,
    preferredSubtitleLanguage: request.subtitlePreference,
    preferredPresentation: animeAudioIntent?.presentation ?? "raw",
    preferredSubtitleDelivery: mode === "anime" ? "hardcoded" : "external",
    qualityPreference: normalizeQualityPreference(request.qualityPreference),
    startupPriority: request.startupPriority ?? "balanced",
    intent,
    allowedRuntimes: ["direct-http"],
  };
}

function normalizeOptionalId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalizeLegacyVideasySourceId(normalized);
}

function normalizeQualityPreference(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "best" || normalized === "auto") return undefined;
  return normalized;
}

export function titleToCoreIdentity(
  title: TitleInfo,
  mode: ShellMode,
  catalogIdentity?: ProviderCatalogIdentity,
  providerId?: string,
): TitleIdentity {
  const kind = mode === "anime" ? "anime" : title.type;
  const year = title.year ? Number.parseInt(title.year, 10) || undefined : undefined;

  if (catalogIdentity) {
    return resolveProviderTitleIdentity(
      {
        id: title.id,
        kind,
        title: title.name,
        year,
        externalIds: title.externalIds,
      },
      catalogIdentity,
      providerId,
    );
  }

  return {
    id: title.id,
    kind,
    title: title.name,
    year,
    anilistId: title.externalIds?.anilistId,
    tmdbId: title.externalIds?.tmdbId,
    imdbId: title.externalIds?.imdbId,
    malId: title.externalIds?.malId,
    externalIds: title.externalIds,
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
    release: episode.release,
    artwork: episode.artwork,
  };
}
