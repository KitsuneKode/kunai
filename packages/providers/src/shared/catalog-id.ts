import type { TitleIdentity } from "@kunai/types";

const TMDB_ID_PREFIX = "tmdb:";

/**
 * A catalog id is a complete positive decimal or it is not a catalog id.
 *
 * `Number.parseInt` is the wrong tool here: it happily reads `123` out of
 * `123abc`, accepts surrounding whitespace, and returns `0` and negatives that
 * then travel on as if they were real ids. Every rejection below is a request
 * that would otherwise reach a provider API and come back as an unexplained
 * empty result.
 */
export function parseCompletePositiveDecimalId(value: string | undefined): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * The one TMDB identity reader for every TMDB-keyed provider.
 *
 * Accepts an explicit `title.tmdbId`, an exact `tmdb:` prefix, or a bare
 * complete decimal `title.id`. The bare form is load-bearing: `kunai -i 438631
 * -t movie` and the live provider smokes both pass a bare numeric id with no
 * `externalIds`, so failing closed on it would take the provider offline.
 */
export function resolveTmdbCatalogId(title: TitleIdentity): number | null {
  const explicit = parseCompletePositiveDecimalId(title.tmdbId);
  if (explicit !== null) return explicit;

  if (title.id.startsWith(TMDB_ID_PREFIX)) {
    return parseCompletePositiveDecimalId(title.id.slice(TMDB_ID_PREFIX.length));
  }

  return parseCompletePositiveDecimalId(title.id);
}
