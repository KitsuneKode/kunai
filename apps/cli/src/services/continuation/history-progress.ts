// =============================================================================
// history-progress.ts — finished-state authority + timestamp formatting
//
// Single authority for "is this episode finished" over the canonical
// HistoryProgress row. Replaces the lossy facade-era isFinished.
// =============================================================================

import { isAnimeOnlyProviderId } from "@/domain/media/content-kind";
import type { ContentType, ProviderLane } from "@/domain/types";
import type { HistoryProgress, HistoryRepository } from "@kunai/storage";
import type { MediaKind } from "@kunai/types";

const FINISHED_RATIO = 0.95;

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
export function correctedHistoryMediaKind(
  progress: Pick<HistoryProgress, "mediaKind" | "externalIds" | "providerId">,
): MediaKind {
  // 1. An anime-only provider (AllAnime/Miruro) is definitive — anime even if stored
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

export function isYoutubeHistoryEntry(
  progress: Pick<HistoryProgress, "mediaKind" | "providerId" | "externalIds">,
): boolean {
  return (
    progress.mediaKind === "video" ||
    progress.providerId === "youtube" ||
    Boolean(progress.externalIds?.youtubeId)
  );
}

/** Canonical provider lane for replaying a persisted history row. */
export function historyProviderLane(
  progress: Pick<HistoryProgress, "mediaKind" | "providerId" | "externalIds">,
): ProviderLane {
  if (isYoutubeHistoryEntry(progress)) return "youtube";
  return correctedHistoryMediaKind(progress) === "anime" ? "anime" : "series";
}

/**
 * Episode label for history/continue UI. YouTube playlist items use `#N` instead of S01E03.
 */
export function historyEpisodeLabel(progress: HistoryProgress): string | undefined {
  if (isYoutubeHistoryEntry(progress)) {
    const index = progress.episode ?? progress.absoluteEpisode;
    if (typeof index === "number" && index > 0) {
      return `#${index}`;
    }
    return undefined;
  }
  if (historyContentType(progress) !== "series") return undefined;
  const season = progress.season ?? 1;
  const episode = progress.episode ?? progress.absoluteEpisode;
  if (typeof episode !== "number") return undefined;
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

/**
 * The movie|series content type for a history row, collapsing anime → "series".
 *
 * The retired `HistoryStore` facade flattened `mediaKind` this way in
 * `HistoryEntry.type`, and several consumers branch on it (offline cleanup,
 * badges, episode labels). This is the single authority for that flatten so
 * callers migrating off `HistoryEntry.type` preserve the exact prior behavior —
 * a naïve `mediaKind` substitution would wrongly treat anime as a third kind.
 */
export function historyContentType(progress: HistoryProgress): ContentType {
  if (progress.mediaKind === "video") {
    const hasEpisode =
      typeof progress.episode === "number" || typeof progress.absoluteEpisode === "number";
    return hasEpisode ? "series" : "movie";
  }
  if (
    progress.mediaKind === "movie" &&
    (progress.providerId === "youtube" || progress.externalIds?.youtubeId)
  ) {
    return "movie";
  }
  return progress.mediaKind === "movie" ? "movie" : "series";
}

export function latestHistoryByTitle(
  entries: readonly HistoryProgress[],
): Record<string, HistoryProgress> {
  const historyByTitle: Record<string, HistoryProgress> = {};
  for (const entry of entries) {
    if (!historyByTitle[entry.titleId]) {
      historyByTitle[entry.titleId] = entry;
    }
  }
  return historyByTitle;
}

export function readLatestHistoryByTitle(
  historyRepository: Pick<HistoryRepository, "listLatestByTitle">,
): Record<string, HistoryProgress> {
  return latestHistoryByTitle(historyRepository.listLatestByTitle());
}

/**
 * Single authority for "is this episode finished".
 * The persisted `completed` flag (written richly from credits/threshold/EOF) wins.
 * The 95% ratio is only a fallback when a positive duration is known.
 */
export function isFinished(progress: HistoryProgress): boolean {
  if (progress.completed) return true;
  const duration = progress.durationSeconds ?? 0;
  if (duration <= 0) return false;
  return progress.positionSeconds / duration >= FINISHED_RATIO;
}

export function formatTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
