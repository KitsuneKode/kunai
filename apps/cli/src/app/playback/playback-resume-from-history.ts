import type { QuitNearEndThresholdMode } from "@/domain/playback/playback-policy";
import { resumeSecondsFromProgressPoint } from "@/domain/playback/playback-progress-policy";
import type { EpisodeInfo } from "@/domain/types";
import { isFinished } from "@/services/continuation/history-progress";
import type { HistoryRepository } from "@kunai/storage";

/**
 * Seconds to resume at for a specific episode from SQLite history, or 0 when we should
 * start from the beginning (no row, finished, too short, or near natural end).
 */
export function resolveBootstrapStartSeconds(input: {
  readonly sharedStartSeconds?: number;
  readonly historyResumeSeconds?: number;
}): number | undefined {
  const shared = input.sharedStartSeconds ?? 0;
  const history = input.historyResumeSeconds ?? 0;
  const best = Math.max(shared, history);
  return best > 0 ? best : undefined;
}

/**
 * Builds the per-episode resume resolver used by the first playback bootstrap.
 *
 * A shared share-link timestamp (`sharedStartSeconds`) wins over local history for the
 * FIRST episode that is resolved (via `max(shared, history)`), then is consumed so every
 * subsequent episode (auto-advance, manual navigation) falls back to plain history resume.
 * This keeps the shared timestamp a true one-shot bootstrap without persisting it.
 */
export function createBootstrapResumeResolver(input: {
  readonly sharedStartSeconds: number | undefined;
  readonly resumeFromHistory: (episode: EpisodeInfo) => number;
}): (episode: EpisodeInfo) => number {
  let applied = false;
  return (episode: EpisodeInfo): number => {
    const historyResume = input.resumeFromHistory(episode);
    if (!applied && input.sharedStartSeconds !== undefined) {
      applied = true;
      return (
        resolveBootstrapStartSeconds({
          sharedStartSeconds: input.sharedStartSeconds,
          historyResumeSeconds: historyResume > 0 ? historyResume : undefined,
        }) ?? historyResume
      );
    }
    return historyResume;
  };
}

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
