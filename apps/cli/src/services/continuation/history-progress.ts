// Finished-state authority + timestamp formatting
//
// Single authority for "is this episode finished" over the canonical
// HistoryProgress row. Replaces the lossy facade-era isFinished.

import type { ContentType, ProviderLane } from "@/domain/types";
import { isYoutubeHistoryEntry } from "@kunai/core";
import { isHistoryProgressFinished } from "@kunai/storage";
import type { HistoryProgress, HistoryRepository } from "@kunai/storage";

export { correctedHistoryMediaKind, historyProviderLane, isYoutubeHistoryEntry } from "@kunai/core";

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

function hasHistoryEpisodeIdentity(
  progress: Pick<HistoryProgress, "episode" | "absoluteEpisode">,
): boolean {
  return typeof progress.episode === "number" || typeof progress.absoluteEpisode === "number";
}

/**
 * Structure (`movie` | `series`) for a history row — not identity.
 *
 * `mediaKind` is the badge (`anime` / `movie` / `series` / `video`). Anime
 * theatrical films persist as `mediaKind: "anime"` with no episode identity;
 * collapsing every anime row to `"series"` relaunches them as S01E01.
 */
export function historyContentType(
  progress: Pick<HistoryProgress, "mediaKind" | "episode" | "absoluteEpisode">,
): ContentType {
  if (progress.mediaKind === "video") {
    return hasHistoryEpisodeIdentity(progress) ? "series" : "movie";
  }
  if (progress.mediaKind === "movie") return "movie";
  if (progress.mediaKind === "anime" && !hasHistoryEpisodeIdentity(progress)) return "movie";
  return "series";
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

/** Optional replay-lane filtering happens in SQLite before the latest-title result cap. */
export function readLatestHistoryByTitle(
  historyRepository: Pick<HistoryRepository, "listLatestByTitle">,
  lane?: ProviderLane,
): Record<string, HistoryProgress> {
  return latestHistoryByTitle(
    lane ? historyRepository.listLatestByTitle(500, lane) : historyRepository.listLatestByTitle(),
  );
}

/**
 * Single authority for "is this episode finished".
 * Only the persisted `completed` flag (natural EOF or explicit mark-watched) wins.
 * Progress ratio and credits timing cannot override an unfinished row.
 */
// Re-exported from @kunai/storage, which owns HistoryProgress. Lower layers
// (domain/queue) need this predicate too and must not import upward.
export function isFinished(progress: HistoryProgress): boolean {
  return isHistoryProgressFinished(progress);
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
