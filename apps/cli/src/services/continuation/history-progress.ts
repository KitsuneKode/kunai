// =============================================================================
// history-progress.ts — finished-state authority + timestamp formatting
//
// Single authority for "is this episode finished" over the canonical
// HistoryProgress row. Replaces the lossy facade-era isFinished.
// =============================================================================

import type { ContentType } from "@/domain/types";
import type { HistoryProgress } from "@kunai/storage";
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
  progress: Pick<HistoryProgress, "mediaKind" | "externalIds">,
): MediaKind {
  if (progress.mediaKind !== "anime") return progress.mediaKind;
  return progress.externalIds?.anilistId || progress.externalIds?.malId ? "anime" : "series";
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
  return progress.mediaKind === "movie" ? "movie" : "series";
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
