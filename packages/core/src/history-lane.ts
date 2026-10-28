import type { MediaKind, ProviderExternalIds, ProviderLane } from "@kunai/types";

type HistoryLaneIdentity = {
  readonly mediaKind: MediaKind;
  readonly providerId?: string;
  readonly externalIds?: ProviderExternalIds;
};

/**
 * Provider ids that ONLY serve anime (their manifests are `mediaKinds: ["anime"]`).
 * A title played through one is anime even when no AniList/MAL id resolved — which is
 * the common case for AllAnime, and the reason most anime were mis-stamped "series".
 * (AllAnime occasionally hosts a live-action drama; the user can reclassify that rare
 * case — defaulting the majority to anime is far more accurate than the reverse.)
 *
 * Domain code cannot load provider manifests, so this mirrors them;
 * `bootstrap-providers.test.ts` fails when a production manifest disagrees.
 */
export const ANIME_ONLY_PROVIDER_IDS = [
  "allanime",
  "anidb",
  "animegg",
  "hianime",
  "kickassanime",
  "miruro",
] as const;

export function isAnimeOnlyProviderId(providerId: string | undefined | null): boolean {
  if (providerId === undefined || providerId === null) return false;
  return ANIME_ONLY_PROVIDER_IDS.some((id) => id === providerId);
}

/**
 * Corrected anime/series/movie kind for a (possibly legacy) history row.
 *
 * `mediaKind` was historically mode-derived, so dramas watched in anime mode were
 * stamped "anime". History stores `externalIds`, so we can re-derive: a stored
 * "anime" row is only really anime when it carries an AniList/MAL id (those DBs
 * only catalog anime). Non-destructive — used by stats + the history type filter
 * so the display is honest without mutating storage. Re-watching re-stamps the
 * row correctly via the write path (resolveContentKind).
 */
export function correctedHistoryMediaKind(progress: HistoryLaneIdentity): MediaKind {
  // 1. An anime-only provider (see ANIME_ONLY_PROVIDER_IDS) is definitive — anime even if stored
  //    "series" with no external id (the common AllAnime mislabel).
  if (isAnimeOnlyProviderId(progress.providerId)) return "anime";
  // 2. An AniList/MAL id is definitive too (those catalogs are anime-only) — so an
  //    anime watched via a TMDB/series provider, or one whose id was self-healed, is
  //    upgraded to anime regardless of the stored kind.
  if (progress.externalIds?.anilistId || progress.externalIds?.malId) return "anime";
  // 3. Otherwise keep the stored kind, except a legacy "anime" with no markers (a
  //    drama watched in anime mode) corrects down to series.
  return progress.mediaKind === "anime" ? "series" : progress.mediaKind;
}

/** YouTube identity wins over legacy kind and provider stamps during replay. */
export function isYoutubeHistoryEntry(progress: HistoryLaneIdentity): boolean {
  return (
    progress.mediaKind === "video" ||
    progress.providerId === "youtube" ||
    Boolean(progress.externalIds?.youtubeId)
  );
}

/** Canonical provider lane for replaying a persisted history row. */
export function historyProviderLane(progress: HistoryLaneIdentity): ProviderLane {
  if (isYoutubeHistoryEntry(progress)) return "youtube";
  return correctedHistoryMediaKind(progress) === "anime" ? "anime" : "series";
}
