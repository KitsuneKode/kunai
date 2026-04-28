import type { PlaybackResult } from "@/domain/types";

export function shouldPersistHistory(result: PlaybackResult): boolean {
  return result.watchedSeconds > 10 || (result.endReason === "eof" && result.duration > 0);
}

export function toHistoryTimestamp(result: PlaybackResult): number {
  if (result.endReason === "eof" && result.duration > 0) {
    return Math.max(result.watchedSeconds, result.duration);
  }

  return result.watchedSeconds;
}
