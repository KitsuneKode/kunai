import {
  didPlaybackReachCompletionThreshold,
  type QuitNearEndThresholdMode,
} from "@/app/playback-policy";
import type { PlaybackResult, PlaybackTimingMetadata } from "@/domain/types";

export type PlaybackProgressPoint = {
  readonly positionSeconds: number;
  readonly durationSeconds: number;
};

export function playbackResultFromProgressPoint(point: PlaybackProgressPoint): PlaybackResult {
  return {
    watchedSeconds: point.positionSeconds,
    duration: point.durationSeconds,
    endReason: "quit",
    lastNonZeroPositionSeconds: point.positionSeconds,
    lastNonZeroDurationSeconds: point.durationSeconds,
    lastReliableProgressSeconds: point.positionSeconds,
  };
}

export function isResumeProgressPoint(
  point: PlaybackProgressPoint,
  thresholdMode: QuitNearEndThresholdMode,
  timing?: PlaybackTimingMetadata | null,
): boolean {
  if (point.positionSeconds <= 10) return false;
  if (
    point.durationSeconds > 0 &&
    point.positionSeconds >= Math.max(0, point.durationSeconds - 5)
  ) {
    return false;
  }

  return !(
    point.durationSeconds > 0 &&
    didPlaybackReachCompletionThreshold(
      playbackResultFromProgressPoint(point),
      timing,
      thresholdMode,
    )
  );
}

export function resumeSecondsFromProgressPoint(
  point: PlaybackProgressPoint,
  thresholdMode: QuitNearEndThresholdMode,
  timing?: PlaybackTimingMetadata | null,
): number {
  return isResumeProgressPoint(point, thresholdMode, timing) ? point.positionSeconds : 0;
}

export function toHistoryTimestamp(
  result: PlaybackResult,
  timing?: PlaybackTimingMetadata | null,
  thresholdMode: QuitNearEndThresholdMode = "credits-or-90-percent",
): number {
  const trusted = result.lastTrustedProgressSeconds ?? 0;
  if (
    (didPlaybackReachCompletionThreshold(result, timing, thresholdMode) ||
      (result.endReason === "eof" && result.duration > 0 && trusted <= 0)) &&
    result.duration > 0
  ) {
    return Math.max(result.watchedSeconds, result.duration);
  }

  const reliable = result.lastReliableProgressSeconds ?? 0;
  if (reliable > 0) {
    return reliable;
  }

  if (trusted > 0) {
    return trusted;
  }

  const lastNon = result.lastNonZeroPositionSeconds ?? 0;
  if (result.watchedSeconds <= 0 && lastNon > 0) {
    return lastNon;
  }

  return result.watchedSeconds;
}
