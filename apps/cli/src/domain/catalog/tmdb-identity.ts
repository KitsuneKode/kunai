import type { ShellMode, TitleInfo } from "@/domain/types";

/** Modes that need proven TMDB identity (ShellMode + timing movie lane). */
export type TmdbIdentityMode = ShellMode | "movie";

const NUMERIC_TMDB_ID = /^\d{1,12}$/;

function normalizeNumericTmdbId(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return NUMERIC_TMDB_ID.test(trimmed) ? trimmed : null;
}

function extractPrefixedTmdbId(id: string): string | null {
  const match = /^tmdb:(\d{1,12})$/.exec(id.trim());
  return match?.[1] ?? null;
}

/**
 * Resolve a numeric TMDB id only when provenance is safe for the content mode.
 *
 * Order: numeric `externalIds.tmdbId`, `tmdb:<id>` title id, then bare numeric
 * title id — but bare numeric is never assumed TMDB in anime mode (AniList ids).
 */
export function resolveProvenNumericTmdbId(
  title: Pick<TitleInfo, "id" | "externalIds">,
  mode: TmdbIdentityMode,
): string | null {
  const fromExternal = normalizeNumericTmdbId(title.externalIds?.tmdbId);
  if (fromExternal) return fromExternal;

  const fromPrefixed = extractPrefixedTmdbId(title.id);
  if (fromPrefixed) return fromPrefixed;

  if (mode !== "anime") {
    return normalizeNumericTmdbId(title.id);
  }

  return null;
}
