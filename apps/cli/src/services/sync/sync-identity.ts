import type { MediaKind, ProviderExternalIds } from "@kunai/types";

/**
 * Tracker id resolution.
 *
 * This module exists because the previous implementation coerced ids across
 * namespaces: `tmdb:1234` and `mal:1234` were both parsed as AniList media ids
 * and pushed as progress. Numeric ids collide freely between catalogs, so that
 * wrote a user's watch progress onto an unrelated anime on their real account.
 *
 * The rule enforced here: an id is only valid for a tracker when it came from
 * that tracker's namespace. There is no numeric fallback, ever. When the id is
 * missing, the caller resolves it through the ARM crosswalk (which is an actual
 * mapping) rather than guessing.
 */

export type TrackerNamespace = "anilist" | "mal" | "tmdb" | "imdb";

/** Prefixes the runtime uses when a title id encodes its source catalog. */
const TITLE_ID_PREFIXES: Readonly<Record<TrackerNamespace, string>> = {
  anilist: "anilist:",
  mal: "mal:",
  tmdb: "tmdb:",
  imdb: "imdb:",
};

export interface TrackerIdSource {
  readonly titleId: string;
  readonly mediaKind: MediaKind;
  readonly externalIds?: ProviderExternalIds;
}

function numericId(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Read a namespaced id straight off the title id, e.g. `tmdb:1399` → `1399`.
 * Returns undefined for every other shape, including bare numbers.
 */
export function idFromTitleId(titleId: string, ns: TrackerNamespace): string | undefined {
  const prefix = TITLE_ID_PREFIXES[ns];
  if (!titleId.startsWith(prefix)) return undefined;
  const rest = titleId.slice(prefix.length).trim();
  if (ns === "imdb") return /^tt\d+$/.test(rest) ? rest : undefined;
  return /^\d+$/.test(rest) ? rest : undefined;
}

/**
 * Resolve the AniList media id for a title.
 *
 * Accepted, in order:
 *   1. `externalIds.anilistId` — set by the catalog identity layer.
 *   2. An `anilist:`-prefixed title id.
 *   3. A bare numeric title id **only** for `kind === "anime"`, which is the
 *      runtime-wide convention for anime-lane ids (see `seedExternalIds` in
 *      CatalogIdentityService).
 *
 * A MAL id is explicitly *not* accepted: MAL and AniList number their catalogs
 * independently, so `mal:1535` is a different work from AniList `1535`. Callers
 * that only hold a MAL id must cross it through ARM first.
 */
export function resolveAniListMediaId(source: TrackerIdSource): number | undefined {
  const fromExternal = numericId(source.externalIds?.anilistId);
  if (fromExternal) return fromExternal;

  const fromTitleId = numericId(idFromTitleId(source.titleId, "anilist"));
  if (fromTitleId) return fromTitleId;

  if (source.mediaKind === "anime") {
    const bare = numericId(source.titleId);
    if (bare) return bare;
  }

  return undefined;
}

/**
 * Resolve the TMDB id for a title. Anime is excluded: the anime lane keys on
 * AniList, and a bare anime id is never a TMDB id.
 */
export function resolveTmdbId(source: TrackerIdSource): number | undefined {
  const fromExternal = numericId(source.externalIds?.tmdbId);
  if (fromExternal) return fromExternal;
  return numericId(idFromTitleId(source.titleId, "tmdb"));
}

/** TMDB's two writable media types. TMDB has no separate "anime" catalog. */
export type TmdbMediaType = "movie" | "tv";

export function resolveTmdbMediaType(mediaKind: MediaKind): TmdbMediaType | undefined {
  if (mediaKind === "movie") return "movie";
  if (mediaKind === "series" || mediaKind === "anime") return "tv";
  // "video" (YouTube and friends) has no TMDB representation.
  return undefined;
}

/**
 * The episode number to report to an episode-based tracker.
 *
 * AniList entries are per-cour: "Attack on Titan Final Season Part 2" is its own
 * entry numbered from 1, not season 4 episode 17. Kunai's anime lane already
 * numbers episodes within the AniList entry, so `episode` is normally correct.
 * The absolute number is only preferred when the local numbering is clearly a
 * multi-season TMDB shape (season > 1) — pushing `episode` there would report
 * episode 3 when the user actually finished episode 27.
 */
export function resolveTrackerEpisode(input: {
  readonly mediaKind: MediaKind;
  readonly season?: number;
  readonly episode?: number;
  readonly absoluteEpisode?: number;
}): number | undefined {
  if (input.mediaKind === "movie") return 1;

  const season = input.season ?? 1;
  if (season > 1 && input.absoluteEpisode !== undefined && input.absoluteEpisode > 0) {
    return input.absoluteEpisode;
  }

  if (input.episode !== undefined && input.episode > 0) return input.episode;
  if (input.absoluteEpisode !== undefined && input.absoluteEpisode > 0)
    return input.absoluteEpisode;
  return undefined;
}

/**
 * Stable dedupe key for the outbox: one pending push per tracker unit of
 * progress. Re-watching the same episode replaces the queued row instead of
 * stacking a second one.
 */
export function syncDedupeKey(input: {
  readonly titleId: string;
  readonly season?: number;
  readonly episode?: number;
}): string {
  const season = input.season ?? 0;
  const episode = input.episode ?? 0;
  return `${input.titleId}|s${season}|e${episode}`;
}
