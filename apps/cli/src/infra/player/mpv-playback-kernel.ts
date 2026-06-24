export type PlaybackProgressSample = {
  readonly positionSeconds: number;
  readonly durationSeconds: number;
};

export type PlaybackProgressThrottleState = {
  lastPlaybackProgressEventAtMs: number;
  lastPlaybackProgressPositionSeconds: number;
  lastPlaybackProgressDurationSeconds: number;
};

export function createPlaybackProgressThrottleState(): PlaybackProgressThrottleState {
  return {
    lastPlaybackProgressEventAtMs: 0,
    lastPlaybackProgressPositionSeconds: -1,
    lastPlaybackProgressDurationSeconds: 0,
  };
}

/** Shared mpv progress emission policy for one-shot and persistent sessions. */
export function shouldEmitPlaybackProgress(
  state: PlaybackProgressThrottleState,
  sample: PlaybackProgressSample | null | undefined,
  observedAtMs: number,
): boolean {
  if (!sample || sample.positionSeconds <= 0) return false;
  const durationChanged =
    sample.durationSeconds > 0 &&
    Math.abs(sample.durationSeconds - state.lastPlaybackProgressDurationSeconds) >= 1;
  const positionChanged =
    Math.abs(sample.positionSeconds - state.lastPlaybackProgressPositionSeconds) >= 15;
  if (
    state.lastPlaybackProgressEventAtMs > 0 &&
    !durationChanged &&
    !positionChanged &&
    observedAtMs - state.lastPlaybackProgressEventAtMs < 15_000
  ) {
    return false;
  }
  state.lastPlaybackProgressEventAtMs = observedAtMs;
  state.lastPlaybackProgressPositionSeconds = sample.positionSeconds;
  state.lastPlaybackProgressDurationSeconds = sample.durationSeconds;
  return true;
}
