import type { SyncIdentity, TrackerIdSource } from "./types";

type AniListIdentity = Extract<SyncIdentity, { tracker: "anilist" }>;
type TmdbIdentity = Extract<SyncIdentity, { tracker: "tmdb" }>;

/**
 * Catalogue ids are bare integers, so every guard here is about refusing to
 * coerce: `parseInt` would happily read "438631x", " 438631" and "43.86" as
 * 438631 and hand a plausible-looking id to a remote write. Only a complete
 * positive decimal is an id.
 */
function positiveDecimal(value: string | undefined): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** The id inside `namespace:id`, or null — including for a foreign namespace. */
function namespacedId(titleId: string, namespace: string): number | null {
  const prefix = `${namespace}:`;
  if (!titleId.startsWith(prefix)) return null;
  return positiveDecimal(titleId.slice(prefix.length));
}

/**
 * Resolve the AniList entry this title addresses, or null.
 *
 * An explicit `externalIds.anilistId` wins; an `anilist:` title id is the only
 * fallback. MAL and TMDB ids are never reinterpreted — they index different
 * catalogues, so the same integer denotes a different show and a write would
 * land silently on the wrong entry of the user's real list.
 *
 * Lane is deliberately *not* consulted. Most anime reaches the shell as a TMDB
 * row whose `type` is `series` — anime-ness rides on a separate flag — so a
 * `mediaKind === "anime"` guard here rejected nearly every real anime while
 * still admitting it to TMDB. The result was the exact inversion of what a user
 * expects: favouriting an anime wrote to TMDB and never to AniList. Both id
 * sources are unambiguous by construction, so they need no lane corroboration.
 */
export function resolveAniListIdentity(source: TrackerIdSource): AniListIdentity | null {
  const anilistId =
    positiveDecimal(source.externalIds?.anilistId) ?? namespacedId(source.titleId, "anilist");
  if (anilistId === null) return null;
  // AniList catalogues anime only, so a resolved entry is anime by definition
  // regardless of the lane the row arrived through.
  return { tracker: "anilist", anilistId, mediaKind: "anime" };
}

/**
 * Resolve the TMDB entry this title addresses, or null.
 *
 * The `anime` lane is deliberately excluded: TMDB has no anime media type, so
 * mapping it would mean guessing `tv` or `movie`. That guess belongs to whoever
 * has the catalogue data, not to identity resolution.
 */
export function resolveTmdbIdentity(source: TrackerIdSource): TmdbIdentity | null {
  if (source.mediaKind !== "movie" && source.mediaKind !== "series") return null;
  const tmdbId =
    positiveDecimal(source.externalIds?.tmdbId) ?? namespacedId(source.titleId, "tmdb");
  if (tmdbId === null) return null;
  return { tracker: "tmdb", tmdbId, mediaKind: source.mediaKind };
}

/**
 * The episode number to report to AniList, or null when it cannot be known.
 *
 * AniList counts within the entry — a cour — so the cour-relative number is the
 * only correct one. An absolute number without it is not convertible here: cour
 * 2 episode 3 and absolute 27 are the same moment, and sending 27 would jump the
 * entry 24 episodes ahead. Declining beats guessing, because the wrong value is
 * written to a real account and looks deliberate.
 */
export function resolveAniListProgressEpisode(input: {
  readonly episode?: number;
  readonly absoluteEpisode?: number;
}): number | null {
  const { episode } = input;
  if (episode === undefined || !Number.isInteger(episode) || episode < 1) return null;
  return episode;
}
