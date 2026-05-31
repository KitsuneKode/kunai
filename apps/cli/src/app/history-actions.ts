import type { HistoryProgress } from "@kunai/storage";

/**
 * Mark a history entry as fully watched without playing it (Netflix/Crunchyroll
 * "mark as watched"). Sets the completed flag — the finished-state authority — and
 * snaps the saved position to the end so progress reads 100%. When the duration is
 * unknown the saved position is preserved (the completed flag still wins).
 */
export function markEntryWatched(
  entry: HistoryProgress,
  now: () => string = () => new Date().toISOString(),
): HistoryProgress {
  const duration = entry.durationSeconds ?? 0;
  return {
    ...entry,
    completed: true,
    positionSeconds: duration > 0 ? duration : entry.positionSeconds,
    updatedAt: now(),
  };
}
