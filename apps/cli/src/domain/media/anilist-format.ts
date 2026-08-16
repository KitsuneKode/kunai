// =============================================================================
// anilist-format.ts — map AniList Media.format onto Kunai's episode axis.
//
// Identity (anime vs series vs movie) is ContentKind. Structure (does this
// title have episodes?) is ContentType. AniList format is the catalog signal
// that stamps structure. Host episode lists are not an input.
// =============================================================================

import type { ContentType, TitleInfo } from "@/domain/types";

const ONE_SHOT_FORMATS: ReadonlySet<string> = new Set(["OVA", "SPECIAL", "TV_SHORT", "MUSIC"]);

/**
 * Deterministic structure from AniList format.
 *
 * - MOVIE is always a film.
 * - One-shot OVA / SPECIAL / TV_SHORT / MUSIC are films (the same S01E01 lie).
 * - TV and ONA stay series even when only episode 1 has aired.
 * - Unknown or missing format stays series — never guess a film.
 */
export function contentTypeFromAniListFormat(
  format: string | undefined,
  episodeCount?: number,
): ContentType {
  const normalized = format?.trim().toUpperCase();
  if (!normalized) return "series";
  if (normalized === "MOVIE") return "movie";
  if (ONE_SHOT_FORMATS.has(normalized)) {
    if (episodeCount === undefined || episodeCount <= 1) return "movie";
    return "series";
  }
  return "series";
}

/** Upgrade-only: a later catalog format may stamp a film, never un-stamp one. */
export function upgradeContentTypeFromAniListFormat(
  current: ContentType,
  format: string | undefined,
  episodeCount?: number,
): ContentType {
  if (current === "movie") return "movie";
  return contentTypeFromAniListFormat(format, episodeCount);
}

/**
 * Apply catalog structure onto a playback title. Upgrade-only: a film stamp
 * drops episode counts so History/Continue cannot keep a leftover S01E01 axis.
 * Missing catalog type leaves the title unchanged — never guess a film.
 */
export function upgradeTitleInfoStructure(
  title: TitleInfo,
  catalogType: ContentType | undefined,
): TitleInfo {
  if (catalogType !== "movie" || title.type === "movie") return title;
  return { ...title, type: "movie", episodeCount: undefined };
}

export type AniListCatalogStructure = {
  readonly type: ContentType;
  readonly episodeCount?: number;
  readonly durationSeconds?: number;
};

/**
 * Search/discovery stamp: films drop episode counts (so rows never say
 * "1 episodes") and carry runtime instead. Series keep episode counts and
 * never treat per-episode duration as title length.
 */
export function anilistCatalogStructure(input: {
  readonly format?: string | null;
  readonly episodes?: number | null;
  readonly durationMinutes?: number | null;
}): AniListCatalogStructure {
  const type = contentTypeFromAniListFormat(input.format ?? undefined, input.episodes ?? undefined);
  if (type === "movie") {
    const minutes = input.durationMinutes;
    return {
      type,
      durationSeconds: typeof minutes === "number" && minutes > 0 ? minutes * 60 : undefined,
    };
  }
  return {
    type,
    episodeCount: input.episodes ?? undefined,
  };
}
