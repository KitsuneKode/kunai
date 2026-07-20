import {
  didPlaybackReachCompletionThreshold,
  type QuitNearEndThresholdMode,
} from "@/domain/playback/playback-policy";
import {
  evaluateProgressEngage,
  trustedProgressFromPlaybackResult,
} from "@/domain/playback/progress-engage-policy";
export { toHistoryTimestamp } from "@/domain/playback/playback-progress-policy";
import type { PlaybackResult, PlaybackTimingMetadata } from "@/domain/types";

export function shouldPersistHistory(
  result: PlaybackResult,
  timing?: PlaybackTimingMetadata | null,
  thresholdMode: QuitNearEndThresholdMode = "credits-or-90-percent",
): boolean {
  const completed = didPlaybackReachCompletionThreshold(result, timing, thresholdMode);
  const trusted = result.lastTrustedProgressSeconds ?? 0;
  const eofOverride =
    result.endReason === "eof" &&
    result.duration > 0 &&
    trusted <= 0 &&
    result.suspectedDeadStream !== true;
  if (completed || eofOverride) return true;
  return evaluateProgressEngage(trustedProgressFromPlaybackResult(result)).canPersistResume;
}
