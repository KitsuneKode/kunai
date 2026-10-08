import {
  shouldMarkEpisodeCompleted,
  type QuitNearEndThresholdMode,
} from "@/domain/playback/playback-policy";
import { PERSIST_RESUME_SECONDS } from "@/domain/playback/progress-engage-policy";
import type { PlaybackResult, PlaybackTimingMetadata } from "@/domain/types";

export type PlaybackProgressPoint = {
  readonly positionSeconds: number;
  readonly durationSeconds: number;
};

/** A stored unfinished point stays resumable regardless of credits or duration ratio. */
export function isResumeProgressPoint(point: PlaybackProgressPoint): boolean {
  return Number.isFinite(point.positionSeconds) && point.positionSeconds > PERSIST_RESUME_SECONDS;
}

export function resumeSecondsFromProgressPoint(point: PlaybackProgressPoint): number {
  return isResumeProgressPoint(point) ? point.positionSeconds : 0;
}

export function toHistoryTimestamp(
  result: PlaybackResult,
  timing?: PlaybackTimingMetadata | null,
  thresholdMode: QuitNearEndThresholdMode = "credits-or-90-percent",
): number {
  const trusted = result.lastTrustedProgressSeconds ?? 0;
  if (shouldMarkEpisodeCompleted(result, timing, thresholdMode) && result.duration > 0) {
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
