import type { HistoryProgress } from "@kunai/storage";

/**
 * @deprecated Use `HistoryRepository.markWatched` via `markMediaItemWatched` instead.
 * Pure transform kept for legacy callers and documentation only.
 */
export function markEntryWatched(
  entry: HistoryProgress,
  now: () => string = () => new Date().toISOString(),
): HistoryProgress {
  const duration = entry.durationSeconds ?? 0;
  const at = now();
  const positionSeconds = duration > 0 ? duration : entry.positionSeconds;
  const watchedSeconds = Math.max(
    entry.watchedSeconds ?? 0,
    duration > 0 ? duration : positionSeconds,
  );
  return {
    ...entry,
    completed: true,
    positionSeconds,
    watchedSeconds,
    lastWatchedAt: at,
    completedAt: at,
    updatedAt: at,
  };
}

/** Mark every episode in a season from 1 through `throughEpisode` as watched. */
export function markSeasonThroughEpisode(
  repository: Pick<import("@kunai/storage").HistoryRepository, "markWatched">,
  title: import("@kunai/types").TitleIdentity,
  season: number,
  throughEpisode: number,
): number {
  const last = Math.max(1, Math.trunc(throughEpisode));
  for (let episode = 1; episode <= last; episode++) {
    repository.markWatched(title, { season, episode });
  }
  return last;
}
