import type { HistoryEntry } from "@/services/persistence/HistoryStore";

/**
 * Mark a history entry as fully watched without playing it (Netflix/Crunchyroll
 * "mark as watched"). Sets the completed flag — the finished-state authority — and
 * snaps the saved position to the end so progress reads 100%. When the duration is
 * unknown the saved position is preserved (the completed flag still wins).
 */
export function markEntryWatched(
  entry: HistoryEntry,
  now: () => string = () => new Date().toISOString(),
): HistoryEntry {
  return {
    ...entry,
    completed: true,
    timestamp: entry.duration > 0 ? entry.duration : entry.timestamp,
    watchedAt: now(),
  };
}
