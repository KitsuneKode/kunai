import type {
  QueuePlaybackFailureContext,
  QueuePlaybackIntent,
} from "@/domain/queue/queue-playback-intent";

export interface QueuePlaybackAttemptPort {
  acknowledgePlaybackStarted(intent: QueuePlaybackIntent, at?: string): boolean;
  rollbackBeforeStart(intent: QueuePlaybackIntent, failure: QueuePlaybackFailureContext): boolean;
}

export interface QueuePlaybackAttempt {
  readonly intent: QueuePlaybackIntent;
  readonly acknowledged: boolean;
  setStage(stage: QueuePlaybackFailureContext["stage"]): void;
  acknowledgeStarted(at?: string): boolean;
  rollbackIfUnacknowledged(code: QueuePlaybackFailureContext["code"], detail?: string): boolean;
}

/**
 * One claimed queue handoff through PlaybackPhase: ack only after confirmed
 * playback-started; pre-start exits restore the same row via rollback.
 */
export function createQueuePlaybackAttempt(
  queue: QueuePlaybackAttemptPort,
  intent: QueuePlaybackIntent,
  options: { readonly now?: () => string } = {},
): QueuePlaybackAttempt {
  const now = options.now ?? (() => new Date().toISOString());
  let acknowledged = false;
  let stage: QueuePlaybackFailureContext["stage"] = "handoff";

  return {
    intent,
    get acknowledged() {
      return acknowledged;
    },
    setStage(next) {
      stage = next;
    },
    acknowledgeStarted(at) {
      if (acknowledged) return true;
      const ok = queue.acknowledgePlaybackStarted(intent, at ?? now());
      if (ok) acknowledged = true;
      return ok;
    },
    rollbackIfUnacknowledged(code, detail) {
      if (acknowledged) return false;
      return queue.rollbackBeforeStart(intent, {
        code,
        stage,
        at: now(),
        ...(detail !== undefined ? { detail } : {}),
      });
    },
  };
}
