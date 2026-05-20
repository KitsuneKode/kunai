import {
  didPlaybackReachCompletionThreshold,
  type QuitNearEndThresholdMode,
} from "@/app/playback-policy";
export { toHistoryTimestamp } from "@/app/playback-progress-policy";
import type { PlaybackResult, PlaybackTimingMetadata } from "@/domain/types";

export function shouldPersistHistory(
  result: PlaybackResult,
  timing?: PlaybackTimingMetadata | null,
  thresholdMode: QuitNearEndThresholdMode = "credits-or-90-percent",
): boolean {
  const trusted = result.lastTrustedProgressSeconds ?? 0;
  return (
    result.watchedSeconds > 10 ||
    trusted > 10 ||
    didPlaybackReachCompletionThreshold(result, timing, thresholdMode) ||
    (result.endReason === "eof" &&
      result.duration > 0 &&
      trusted <= 0 &&
      result.suspectedDeadStream !== true)
  );
}
