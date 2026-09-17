import { assertTitleMatchesShellMode } from "@/domain/provider-lane-contract";
import type { EpisodeInfo, ShellMode, TitleInfo } from "@/domain/types";
import {
  mapAnimeEpisodeToTmdbCoordinates,
  mapTmdbEpisodeToAnimeCoordinates,
  resolveProviderTitleIdentity,
  type ProviderCatalogIdentity,
} from "@kunai/core";
import { normalizeLegacyVideasySourceId, resolveAnimeAudioIntent } from "@kunai/providers";
import type {
  EpisodeIdentity,
  MediaKind,
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

export type StreamRequestAdapterOptions = {
  /** ARM `themoviedb-season` for the title's AniList entry — enables cross-lane episode maps. */
  readonly tmdbSeasonHint?: number;
};

export function streamRequestToResolveInput(
  request: StreamRequestLike,
  mode: ShellMode,
  intent: ProviderResolveInput["intent"] = "play",
  catalogIdentity?: ProviderCatalogIdentity,
  providerId?: string,
  options?: StreamRequestAdapterOptions,
): ProviderResolveInput {
  assertTitleMatchesShellMode(request.title, mode);
  // Enriched once, before lane adaptation: `adaptResolveLane` gates the
  // anime lane on holding an anime catalog id, so a title that only learns its
  // AniList id from the episode rows has to carry it by this point too.
  const title = withEpisodeCatalogIdentity(request.title, request.episode);
  const naturalKind: MediaKind =
    mode === "youtube" ? "video" : mode === "anime" ? "anime" : title.type;
  const adapted = adaptResolveLane({
    title,
    naturalKind,
    episode: episodeToCoreIdentity(request.episode),
    catalogIdentity,
    providerId,
    tmdbSeasonHint: options?.tmdbSeasonHint,
  });
  const animeAudioIntent =
    adapted.mediaKind === "anime" ? resolveAnimeAudioIntent(request.audioPreference) : null;
  return {
    title: titleToCoreIdentity(title, mode, catalogIdentity, providerId, adapted.mediaKind),
    episode: adapted.episode,
    mediaKind: adapted.mediaKind,
    preferredSourceId: normalizeOptionalId(request.selectedSourceId),
    preferredStreamId: normalizeOptionalId(request.selectedStreamId),
    favoriteSourceNames:
      request.favoriteSourceNames && request.favoriteSourceNames.length > 0
        ? request.favoriteSourceNames
        : undefined,
    preferredAudioLanguage: animeAudioIntent?.preferredAudioLanguage,
    preferredSubtitleLanguage: request.subtitlePreference,
    preferredPresentation: animeAudioIntent?.presentation ?? "raw",
    preferredSubtitleDelivery: adapted.mediaKind === "anime" ? "hardcoded" : "external",
    qualityPreference: normalizeQualityPreference(request.qualityPreference),
    startupPriority: request.startupPriority ?? "balanced",
    intent,
    allowedRuntimes: ["direct-http"],
  };
}

/**
 * Dual-lane adaptation (catalog-identity-parity Phase 3): when the title's id
 * bag proves it exists in the target provider's catalog, adapt mediaKind and
 * episode coordinates instead of letting the engine reject the request. Fails
 * closed: without a confident episode map the natural kind is kept, so the
 * engine skips the provider rather than resolving the wrong episode.
 */
function adaptResolveLane(args: {
  readonly title: TitleInfo;
  readonly naturalKind: MediaKind;
  readonly episode: EpisodeIdentity | undefined;
  readonly catalogIdentity?: ProviderCatalogIdentity;
  readonly providerId?: string;
  readonly tmdbSeasonHint?: number;
}): { readonly mediaKind: MediaKind; readonly episode?: EpisodeIdentity } {
  const { title, naturalKind, episode, catalogIdentity, providerId, tmdbSeasonHint } = args;
  const hint = tmdbSeasonHint !== undefined ? { tmdbSeason: tmdbSeasonHint } : undefined;

  if (naturalKind === "anime" && catalogIdentity === "tmdb") {
    if (!title.externalIds?.tmdbId) return { mediaKind: naturalKind, episode };
    if (title.type === "movie") return { mediaKind: "movie", episode: undefined };
    if (!episode) return { mediaKind: "series", episode };
    const mapped = mapAnimeEpisodeToTmdbCoordinates(episode, hint);
    return mapped ? { mediaKind: "series", episode: mapped } : { mediaKind: naturalKind, episode };
  }

  if (
    (naturalKind === "series" || naturalKind === "movie") &&
    (catalogIdentity === "anilist" || catalogIdentity === "provider-native")
  ) {
    const hasAnimeCatalogId =
      Boolean(title.externalIds?.anilistId) ||
      Boolean(
        providerId &&
        title.externalIds?.providerNativeIds?.[
          providerId as keyof NonNullable<typeof title.externalIds.providerNativeIds>
        ],
      );
    if (!hasAnimeCatalogId) return { mediaKind: naturalKind, episode };
    if (naturalKind === "movie" || !episode) return { mediaKind: "anime", episode };
    const mapped = mapTmdbEpisodeToAnimeCoordinates(episode, hint);
    return mapped ? { mediaKind: "anime", episode: mapped } : { mediaKind: naturalKind, episode };
  }

  return { mediaKind: naturalKind, episode };
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

/**
 * Lift cross-catalog ids discovered while listing episodes onto the title.
 *
 * A provider-native catalog answers search with its own id and nothing else —
 * AniDB returns `gintama-1816`, and only learns the AniList/MAL ids later, when
 * `listEpisodes` reads the show page. Those ids reached the episode rows and
 * stopped there, because `EpisodeIdentity` has no place to carry them. So a
 * fallback from AniDB to Miruro handed over a title with no AniList id and was
 * rejected `unsupported-title` — with AllAnime gated upstream that left the
 * default anime provider with no reachable fallback at all. AllManga never hit
 * this: AllAnime's search response includes `aniListId`, so its titles carried
 * a shared identity from the first result.
 *
 * Gap-filling only. A title that already knows its own id keeps it; an episode
 * cannot rewrite the identity of the title it belongs to.
 */
function withEpisodeCatalogIdentity(title: TitleInfo, episode: EpisodeInfo | undefined): TitleInfo {
  const discovered = episode?.externalIds;
  if (!discovered) return title;

  const anilistId = title.externalIds?.anilistId ?? discovered.anilistId;
  const malId = title.externalIds?.malId ?? discovered.malId;
  if (anilistId === title.externalIds?.anilistId && malId === title.externalIds?.malId) {
    return title;
  }

  return {
    ...title,
    externalIds: {
      ...title.externalIds,
      ...(anilistId !== undefined ? { anilistId } : {}),
      ...(malId !== undefined ? { malId } : {}),
    },
  };
}

export function titleToCoreIdentity(
  title: TitleInfo,
  mode: ShellMode,
  catalogIdentity?: ProviderCatalogIdentity,
  providerId?: string,
  kindOverride?: MediaKind,
): TitleIdentity {
  const kind =
    kindOverride ?? (mode === "youtube" ? "video" : mode === "anime" ? "anime" : title.type);
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
    absoluteEpisode: episode.absoluteEpisode,
    providerEpisodeIdentity: episode.providerEpisodeIdentity,
    title: episode.name,
    airDate: episode.airDate,
    release: episode.release,
    artwork: episode.artwork,
  };
}
