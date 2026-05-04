import { toHistoryTimestamp } from "@/app/playback-history";
import {
  didPlaybackReachCompletionThreshold,
  type QuitNearEndThresholdMode,
} from "@/app/playback-policy";
import type { EpisodeInfo, PlaybackResult, PlaybackTimingMetadata } from "@/domain/types";

export type UndoAdvanceFrame = {
  episode: EpisodeInfo;
  positionSeconds: number;
  durationSeconds: number;
};

export function sameEpisode(a: EpisodeInfo, b: EpisodeInfo): boolean {
  return a.season === b.season && a.episode === b.episode;
}

function syntheticResultForUndoCheck(
  positionSeconds: number,
  durationSeconds: number,
): PlaybackResult {
  return {
    watchedSeconds: positionSeconds,
    duration: durationSeconds,
    endReason: "quit",
    lastNonZeroPositionSeconds: positionSeconds,
    lastNonZeroDurationSeconds: durationSeconds,
  };
}

/** Resume seconds for an undo frame, or 0 when we should start the episode from the beginning. */
export function guardedUndoResumeSeconds(
  positionSeconds: number,
  durationSeconds: number,
  thresholdMode: QuitNearEndThresholdMode,
  timing?: PlaybackTimingMetadata | null,
): number {
  if (positionSeconds <= 10) return 0;
  if (durationSeconds > 0 && positionSeconds >= Math.max(0, durationSeconds - 5)) return 0;

  const synthetic = syntheticResultForUndoCheck(positionSeconds, durationSeconds);
  if (
    durationSeconds > 0 &&
    didPlaybackReachCompletionThreshold(synthetic, timing, thresholdMode)
  ) {
    return 0;
  }

  return positionSeconds;
}

/** Call when leaving an episode via next / auto-next so P can restore the prior position. */
export function pushUndoAdvanceFrame(
  stack: UndoAdvanceFrame[],
  args: {
    leftEpisode: EpisodeInfo;
    result: PlaybackResult;
    timing: PlaybackTimingMetadata | null;
    thresholdMode: QuitNearEndThresholdMode;
    maxDepth?: number;
  },
): void {
  const { leftEpisode, result, timing, thresholdMode, maxDepth = 12 } = args;
  const positionSeconds = toHistoryTimestamp(result, timing, thresholdMode);
  const durationSeconds =
    result.duration > 0 ? result.duration : (result.lastNonZeroDurationSeconds ?? 0);

  stack.push({
    episode: { season: leftEpisode.season, episode: leftEpisode.episode },
    positionSeconds,
    durationSeconds,
  });
  while (stack.length > maxDepth) {
    stack.shift();
  }
}

/**
 * If the stack says we just left `targetPreviousEpisode`, pop it and return a guarded resume
 * offset; otherwise return 0. Stale frames that do not match are discarded.
 */
export function consumeUndoAdvanceResume(
  stack: UndoAdvanceFrame[],
  targetPreviousEpisode: EpisodeInfo,
  thresholdMode: QuitNearEndThresholdMode,
  timing?: PlaybackTimingMetadata | null,
): number {
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    if (sameEpisode(top.episode, targetPreviousEpisode)) {
      stack.pop();
      return guardedUndoResumeSeconds(
        top.positionSeconds,
        top.durationSeconds,
        thresholdMode,
        timing,
      );
    }
    stack.pop();
  }
  return 0;
}
