import type { EpisodeInfo, ShellMode, TitleInfo } from "@/domain/types";
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
): ProviderResolveInput {
  const animeAudioIntent =
    mode === "anime" ? resolveAnimeAudioIntent(request.audioPreference) : null;
  return {
    title: titleToCoreIdentity(request.title, mode),
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

export function titleToCoreIdentity(title: TitleInfo, mode: ShellMode): TitleIdentity {
  const kind = mode === "anime" ? "anime" : title.type;

  return {
    id: title.id,
    kind,
    title: title.name,
    year: title.year ? Number.parseInt(title.year, 10) || undefined : undefined,
    tmdbId: title.externalIds?.tmdbId ?? (kind === "anime" ? undefined : title.id),
    anilistId:
      title.externalIds?.anilistId ??
      (kind === "anime" && isNumericId(title.id) ? title.id : undefined),
    imdbId: title.externalIds?.imdbId,
    malId: title.externalIds?.malId,
    externalIds: title.externalIds,
  };
}

function isNumericId(id: string): boolean {
  return /^\d+$/.test(id);
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
