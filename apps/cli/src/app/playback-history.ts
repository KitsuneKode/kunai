import { didPlaybackReachCompletionThreshold } from "@/app/playback-policy";
import type { PlaybackResult, PlaybackTimingMetadata } from "@/domain/types";

export function shouldPersistHistory(
  result: PlaybackResult,
  timing?: PlaybackTimingMetadata | null,
): boolean {
  return (
    result.watchedSeconds > 10 ||
    didPlaybackReachCompletionThreshold(result, timing) ||
    (result.endReason === "eof" && result.duration > 0)
  );
}

export function toHistoryTimestamp(
  result: PlaybackResult,
  timing?: PlaybackTimingMetadata | null,
): number {
  if (
    (didPlaybackReachCompletionThreshold(result, timing) ||
      (result.endReason === "eof" && result.duration > 0)) &&
    result.duration > 0
  ) {
    return Math.max(result.watchedSeconds, result.duration);
  }

  return result.watchedSeconds;
}
