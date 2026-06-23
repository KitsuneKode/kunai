import type { QuitNearEndThresholdMode } from "@/domain/playback/playback-policy";
import { resumeSecondsFromProgressPoint } from "@/domain/playback/playback-progress-policy";
import type { EpisodeInfo } from "@/domain/types";
import { isFinished } from "@/services/continuation/history-progress";
import type { HistoryRepository } from "@kunai/storage";

/**
 * Seconds to resume at for a specific episode from SQLite history, or 0 when we should
 * start from the beginning (no row, finished, too short, or near natural end).
 */
export function resumeSecondsFromHistoryForEpisode(
  historyRepository: HistoryRepository,
  titleId: string,
  episode: EpisodeInfo,
  quitNearEndThresholdMode: QuitNearEndThresholdMode,
): number {
  const entry = historyRepository
    .listByTitle(titleId)
    .find(
      (e) =>
        (e.season ?? 1) === episode.season && (e.episode ?? e.absoluteEpisode) === episode.episode,
    );
  if (!entry) return 0;
  if (isFinished(entry)) return 0;

  return resumeSecondsFromProgressPoint(
    { positionSeconds: entry.positionSeconds, durationSeconds: entry.durationSeconds ?? 0 },
    quitNearEndThresholdMode,
  );
}
