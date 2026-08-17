// =============================================================================
// content-kind.ts — identity (anime vs series vs movie vs video) is separate
// from structure (does this title have an episode axis?).
//
// ContentKind is the badge, history stamp, and language profile. ContentType
// (`title.type`) is whether season/episode chrome is product-visible. An anime
// theatrical film is kind "anime" and type "movie": `@ anime`, runtime, no S/E.
// ShellMode is provider routing only and must never decide either axis.
// =============================================================================

import type { ContentType, ShellMode, TitleInfo } from "@/domain/types";
import type { MediaLanguageProfile } from "@/services/persistence/ConfigService";

export type ContentKind = "movie" | "series" | "anime" | "video";

const YOUTUBE_PROVIDER_ID = "youtube";

export function isYoutubeShellMode(mode: ShellMode): boolean {
  return mode === "youtube";
}

export function isYoutubeProviderId(providerId: string | undefined | null): boolean {
  return providerId === YOUTUBE_PROVIDER_ID;
}

/** TMDB genre id for "Animation". */
const TMDB_ANIMATION_GENRE_ID = 16;

/**
 * Provider ids that ONLY serve anime (their manifests are `mediaKinds: ["anime"]`).
 * A title played through one is anime even when no AniList/MAL id resolved — which is
 * the common case for AllAnime, and the reason most anime were mis-stamped "series".
 * (AllAnime occasionally hosts a live-action drama; the user can reclassify that rare
 * case — defaulting the majority to anime is far more accurate than the reverse.)
 */
const ANIME_ONLY_PROVIDER_IDS: ReadonlySet<string> = new Set(["allanime", "miruro"]);

export function isAnimeOnlyProviderId(providerId: string | undefined | null): boolean {
  if (providerId === undefined || providerId === null) return false;
  return ANIME_ONLY_PROVIDER_IDS.has(providerId);
}

/**
 * Whether a title's *content* is genuinely anime — independent of ShellMode.
 * AniList/MAL only catalog anime, so an id from either is authoritative; TMDB's
 * Animation genre is a secondary signal. A live-action C/K-drama hosted on an
 * anime provider (AllAnime serves these) carries none of these → not anime.
 */
export function isAnimeContent(
  title: Pick<TitleInfo, "externalIds" | "genreIds" | "isAnime"> | null | undefined,
): boolean {
  if (!title) return false;
  return Boolean(
    title.isAnime ||
    title.externalIds?.anilistId ||
    title.externalIds?.malId ||
    title.genreIds?.includes(TMDB_ANIMATION_GENRE_ID),
  );
}

export type ContentKindTitle = Pick<TitleInfo, "type" | "externalIds" | "genreIds" | "isAnime">;

function isAnimeIdentity(
  title: ContentKindTitle | null | undefined,
  options: { readonly providerId?: string | null } = {},
): boolean {
  return (
    title?.isAnime === true || isAnimeContent(title) || isAnimeOnlyProviderId(options.providerId)
  );
}

/**
 * Content kind for the CURRENT SESSION (header crumb, language profile).
 * Anime identity (AniList/MAL, TMDB Animation, anime-only provider) wins over
 * both ShellMode and movie structure so theatrical films stay `@ anime`.
 * ShellMode is the fallback when the title has no identity markers.
 * Use classifyPersistedKind for anything stored in history.
 *
 * Structure (`title.type`) is a separate axis from identity. An anime theatrical
 * film is type "movie" and kind "anime" so it keeps the anime badge and language
 * profile while hiding season/episode chrome.
 */
export function resolveContentKind(
  title: ContentKindTitle | null | undefined,
  mode: ShellMode,
  options: { readonly providerId?: string | null } = {},
): ContentKind {
  if (isYoutubeShellMode(mode)) return "video";
  if (isAnimeIdentity(title, options)) return "anime";
  if (title?.type === "movie") return "movie";
  return mode === "anime" ? "anime" : "series";
}

/**
 * Content kind to PERSIST (watch history). Unlike resolveContentKind, "anime" is
 * only stamped when the content corroborates it (an AniList/MAL id, TMDB
 * Animation genre, anime-only provider, or the deterministic `isAnime` tag) —
 * so a live-action drama watched in anime mode (AllAnime hosts these) is not
 * labeled anime forever. Anime films keep kind "anime" even when type is movie.
 */
export function classifyPersistedKind(
  title: ContentKindTitle | null | undefined,
  mode: ShellMode,
  options: { readonly providerId?: string | null } = {},
): ContentKind {
  if (isYoutubeShellMode(mode) || isYoutubeProviderId(options.providerId)) return "video";
  if (isAnimeIdentity(title, options)) return "anime";
  if (title?.type === "movie") return "movie";
  return "series";
}

/** Movies have no season/episode — never render an S·E label for them. */
export function showsEpisodeLabel(title: Pick<TitleInfo, "type"> | null | undefined): boolean {
  return title?.type !== "movie";
}

/**
 * Whether this kind has an episode list worth offering.
 *
 * The `ContentKind` sibling of {@link showsEpisodeLabel}, for surfaces that hold
 * a resolved kind rather than a `TitleInfo`. A standalone video has no episode
 * list either, so offering "e episodes" on one is as wrong as on a movie.
 */
export function contentKindHasEpisodes(kind: ContentKind | undefined, type?: ContentType): boolean {
  if (type === "movie") return false;
  return kind === "series" || kind === "anime";
}

/** A title-level item has no episode/runway axis, regardless of its identity badge. */
export function isTitleLevelContent(
  kind: ContentKind | undefined,
  type: ContentType | undefined,
): boolean {
  return kind === "movie" || kind === "video" || type === "movie";
}

/** Pick the language profile (audio/subtitle/quality) matching the content kind. */
export function mediaLanguageProfileFor(input: {
  readonly mode: ShellMode;
  readonly currentTitle: ContentKindTitle | null;
  readonly animeLanguageProfile: MediaLanguageProfile;
  readonly seriesLanguageProfile: MediaLanguageProfile;
  readonly movieLanguageProfile: MediaLanguageProfile;
  readonly youtubeLanguageProfile?: MediaLanguageProfile;
}): MediaLanguageProfile {
  const kind = resolveContentKind(input.currentTitle, input.mode);
  if (kind === "video") {
    return input.youtubeLanguageProfile ?? input.movieLanguageProfile;
  }
  if (kind === "anime") return input.animeLanguageProfile;
  if (kind === "movie") return input.movieLanguageProfile;
  return input.seriesLanguageProfile;
}
