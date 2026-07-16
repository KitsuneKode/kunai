import type { EpisodeIdentity } from "@kunai/types";

/**
 * Episode coordinate mapping between the anime lane (per-AniList-entry episode
 * numbers, season is nominally 1) and the TMDB lane (real season/episode).
 * ARM's `themoviedb-season` tells us which TMDB season an AniList entry covers;
 * without that map we FAIL CLOSED (return null) instead of guessing — a wrong
 * auto-map plays the wrong episode. See .plans/catalog-identity-parity.md §5.
 */
export type EpisodeMapHint = {
  /** TMDB season the AniList/MAL entry corresponds to (from ARM). */
  readonly tmdbSeason?: number;
};

/** Anime-entry episode → TMDB coordinates. Null when no confident map exists. */
export function mapAnimeEpisodeToTmdbCoordinates(
  episode: EpisodeIdentity,
  hint: EpisodeMapHint | undefined,
): EpisodeIdentity | null {
  if (typeof episode.episode !== "number") return null;
  if (hint?.tmdbSeason === undefined) return null;
  return { ...episode, season: hint.tmdbSeason };
}

/** TMDB coordinates → anime-entry episode. Null when no confident map exists. */
export function mapTmdbEpisodeToAnimeCoordinates(
  episode: EpisodeIdentity,
  hint: EpisodeMapHint | undefined,
): EpisodeIdentity | null {
  if (typeof episode.episode !== "number") return null;
  if (hint?.tmdbSeason !== undefined) {
    return episode.season === hint.tmdbSeason ? { ...episode, season: 1 } : null;
  }
  // Season 1 is the first entry on both sides; anything later needs a map.
  return episode.season === 1 || episode.season === undefined ? episode : null;
}
