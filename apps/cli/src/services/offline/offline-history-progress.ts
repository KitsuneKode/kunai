import { projectWatchProgress } from "@/domain/continuation/watch-progress";
import { formatTimestamp, isFinished } from "@/services/continuation/history-progress";
import type { DownloadJobRecord, HistoryProgress } from "@kunai/storage";

export function formatOfflineHistoryProgress(
  job: DownloadJobRecord,
  historyEntries: readonly HistoryProgress[],
): string | null {
  const match = findMatchingHistory(job, historyEntries);
  if (!match) return null;
  if (isFinished(match)) return "watched";

  const timestampSeconds = Math.max(0, match.positionSeconds ?? 0);
  if (timestampSeconds <= 0) return null;

  const durationSeconds =
    typeof match.durationSeconds === "number" && match.durationSeconds > 0
      ? match.durationSeconds
      : typeof job.durationMs === "number" && job.durationMs > 0
        ? job.durationMs / 1_000
        : null;
  const percent = projectWatchProgress({
    timestamp: timestampSeconds,
    duration: durationSeconds ?? undefined,
  }).percentage;

  return [`resume ${formatTimestamp(timestampSeconds)}`, percent ? `${percent}% watched` : null]
    .filter(Boolean)
    .join(" · ");
}

/** Saved resume position (seconds) for a downloaded episode, or 0 if finished/none. */
export function offlineResumeSecondsForJob(
  job: DownloadJobRecord,
  historyEntries: readonly HistoryProgress[],
): number {
  const match = findMatchingHistory(job, historyEntries);
  if (!match || isFinished(match)) return 0;
  return Math.max(0, match.positionSeconds ?? 0);
}

function findMatchingHistory(
  job: DownloadJobRecord,
  historyEntries: readonly HistoryProgress[],
): HistoryProgress | null {
  const matches = historyEntries.filter((entry) => {
    if ((entry.season ?? 1) !== job.season) return false;
    if ((entry.episode ?? entry.absoluteEpisode) !== job.episode) return false;
    return true;
  });
  return matches.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null;
}
