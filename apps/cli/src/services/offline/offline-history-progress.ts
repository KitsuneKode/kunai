import { projectWatchProgress } from "@/domain/continuation/watch-progress";
import type { HistoryEntry } from "@/services/persistence/HistoryStore";
import { formatTimestamp, isFinished } from "@/services/persistence/HistoryStore";
import type { DownloadJobRecord } from "@kunai/storage";

export function formatOfflineHistoryProgress(
  job: DownloadJobRecord,
  historyEntries: readonly HistoryEntry[],
): string | null {
  const match = findMatchingHistory(job, historyEntries);
  if (!match) return null;
  if (isFinished(match)) return "watched";

  const timestampSeconds = Math.max(0, match.timestamp ?? 0);
  if (timestampSeconds <= 0) return null;

  const durationSeconds =
    typeof match.duration === "number" && match.duration > 0
      ? match.duration
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

function findMatchingHistory(
  job: DownloadJobRecord,
  historyEntries: readonly HistoryEntry[],
): HistoryEntry | null {
  const matches = historyEntries.filter((entry) => {
    if (entry.season !== job.season) return false;
    if (entry.episode !== job.episode) return false;
    return true;
  });
  return matches.sort((a, b) => Date.parse(b.watchedAt) - Date.parse(a.watchedAt))[0] ?? null;
}
