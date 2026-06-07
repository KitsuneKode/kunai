// =============================================================================
// content-kind.ts — derive content kind (and the matching language profile) from
// content truth, not ShellMode.
//
// ShellMode ("series" | "anime") is provider routing only and must never decide
// content labels. Content kind is the title's ContentType ("movie" | "series"),
// with "anime" distinguished by mode. Lives in domain/ alongside playable-ref so
// both the shell (app-shell/) and phases (app/) reuse one source of truth.
// =============================================================================

import type { ShellMode, TitleInfo } from "@/domain/types";
import type { MediaLanguageProfile } from "@/services/persistence/ConfigService";

export type ContentKind = "movie" | "series" | "anime";

/** TMDB genre id for "Animation". */
const TMDB_ANIMATION_GENRE_ID = 16;

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

/**
 * Content kind for the CURRENT SESSION (header crumb, language profile). ShellMode
 * is the right signal here — it reflects the routing/profile in use right now, not
 * a permanent label. Use classifyPersistedKind for anything stored in history.
 */
export function resolveContentKind(
  title: Pick<TitleInfo, "type"> | null | undefined,
  mode: ShellMode,
): ContentKind {
  if (title?.type === "movie") return "movie";
  return mode === "anime" ? "anime" : "series";
}

/**
 * Content kind to PERSIST (watch history). Unlike resolveContentKind, "anime" is
 * only stamped when the ShellMode is anime AND the content corroborates it (an
 * AniList/MAL id or TMDB Animation genre) — so a live-action drama watched in
 * anime mode (AllAnime hosts these) is not labeled anime forever. See #1.
 */
export function classifyPersistedKind(
  title: Pick<TitleInfo, "type" | "externalIds" | "genreIds" | "isAnime"> | null | undefined,
  mode: ShellMode,
): ContentKind {
  if (title?.type === "movie") return "movie";
  // The deterministic classifier tag (TMDB original_language=ja etc.) is
  // authoritative regardless of ShellMode — so an anime watched via a series
  // provider (e.g. vidking) is still labeled anime in history. Without that tag,
  // fall back to the old rule: anime mode AND a content marker (so AllAnime's
  // live-action dramas in anime mode aren't mislabeled).
  if (title?.isAnime === true) return "anime";
  if (mode === "anime" && isAnimeContent(title)) return "anime";
  return "series";
}

/** Movies have no season/episode — never render an S·E label for them. */
export function showsEpisodeLabel(title: Pick<TitleInfo, "type"> | null | undefined): boolean {
  return title?.type !== "movie";
}

/** Pick the language profile (audio/subtitle/quality) matching the content kind. */
export function mediaLanguageProfileFor(input: {
  readonly mode: ShellMode;
  readonly currentTitle: Pick<TitleInfo, "type"> | null;
  readonly animeLanguageProfile: MediaLanguageProfile;
  readonly seriesLanguageProfile: MediaLanguageProfile;
  readonly movieLanguageProfile: MediaLanguageProfile;
}): MediaLanguageProfile {
  const kind = resolveContentKind(input.currentTitle, input.mode);
  if (kind === "anime") return input.animeLanguageProfile;
  if (kind === "movie") return input.movieLanguageProfile;
  return input.seriesLanguageProfile;
}
