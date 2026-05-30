// =============================================================================
// history-progress.ts — finished-state authority + timestamp formatting
//
// Single authority for "is this episode finished" over the canonical
// HistoryProgress row. Replaces the lossy facade-era isFinished.
// =============================================================================

import type { HistoryProgress } from "@kunai/storage";

const FINISHED_RATIO = 0.95;

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
