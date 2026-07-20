export const PERSIST_RESUME_SECONDS = 10;
export const ENGAGE_SECONDS = 30;

export type ProgressEngageEvidence = {
  readonly trustedProgressSeconds: number;
  readonly durationSeconds: number;
  readonly suspectedDeadStream?: boolean;
  readonly endReason?: "quit" | "eof" | "error" | "abort";
  readonly watchedSeconds?: number;
};

export type ProgressEngageDecision = {
  readonly canPersistResume: boolean;
  readonly isEngaged: boolean;
  readonly isDidNotStart: boolean;
  readonly shouldBumpLastWatched: boolean;
};

export function isDidNotStartProgress(evidence: ProgressEngageEvidence): boolean {
  return evidence.trustedProgressSeconds <= 0 && evidence.durationSeconds > 0;
}

export function evaluateProgressEngage(
  evidence: ProgressEngageEvidence,
  options?: { readonly reachedCompletionThreshold?: boolean },
): ProgressEngageDecision {
  const isDidNotStart = isDidNotStartProgress(evidence);
  const canPersistResume =
    !isDidNotStart && evidence.trustedProgressSeconds > PERSIST_RESUME_SECONDS;
  const isEngaged = !isDidNotStart && evidence.trustedProgressSeconds > ENGAGE_SECONDS;
  const shouldBumpLastWatched = isEngaged || options?.reachedCompletionThreshold === true;
  return { canPersistResume, isEngaged, isDidNotStart, shouldBumpLastWatched };
}

export function trustedProgressFromPlaybackResult(result: {
  readonly lastTrustedProgressSeconds?: number;
  readonly watchedSeconds: number;
  readonly duration: number;
  readonly endReason: ProgressEngageEvidence["endReason"];
  readonly suspectedDeadStream?: boolean;
}): ProgressEngageEvidence {
  return {
    trustedProgressSeconds: result.lastTrustedProgressSeconds ?? 0,
    durationSeconds: result.duration,
    suspectedDeadStream: result.suspectedDeadStream,
    endReason: result.endReason,
    watchedSeconds: result.watchedSeconds,
  };
}
