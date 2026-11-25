import type {
  QueuePlaybackFailureContext,
  QueuePlaybackIntent,
} from "@/domain/queue/queue-playback-intent";
import type { EpisodeInfo } from "@/domain/types";

export interface QueuePlaybackAttemptPort {
  acknowledgePlaybackStarted(intent: QueuePlaybackIntent, at?: string): boolean;
  rollbackBeforeStart(intent: QueuePlaybackIntent, failure: QueuePlaybackFailureContext): boolean;
}

export interface QueuePlaybackAttempt {
  readonly intent: QueuePlaybackIntent;
  readonly acknowledged: boolean;
  setStage(stage: QueuePlaybackFailureContext["stage"]): void;
  /** `started` is the episode that began; a claim naming another one is not consumed. */
  acknowledgeStarted(at?: string, started?: EpisodeInfo): boolean;
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
  let rolledBack = false;
  let stage: QueuePlaybackFailureContext["stage"] = "handoff";

  return {
    intent,
    get acknowledged() {
      return acknowledged;
    },
    setStage(next) {
      stage = next;
    },
    acknowledgeStarted(at, started) {
      if (acknowledged) return true;
      if (rolledBack) return false;
      // Left unacknowledged, the phase's exit rolls the row back to pending.
      if (!startedEpisodeMatchesClaim(intent, started)) return false;
      const ok = queue.acknowledgePlaybackStarted(intent, at ?? now());
      if (ok) acknowledged = true;
      return ok;
    },
    rollbackIfUnacknowledged(code, detail) {
      if (acknowledged || rolledBack) return false;
      const restored = queue.rollbackBeforeStart(intent, {
        code,
        stage,
        at: now(),
        ...(detail !== undefined ? { detail } : null),
      });
      if (restored) rolledBack = true;
      return restored;
    },
  };
}

/**
 * A queue row naming an episode is consumed only by that episode starting.
 * Acknowledging by row id alone let a viewer who picked S01E01 instead of the
 * queued S02E07 mark S02E07 played (Sol review #1). Title-level rows and
 * movies are consumed by whatever starts. Anime may report either numbering.
 */
export function startedEpisodeMatchesClaim(
  intent: QueuePlaybackIntent,
  started: EpisodeInfo | undefined,
): boolean {
  if (!started || intent.mediaKind === "movie" || intent.contentType === "movie") return true;
  const { season, episode, absoluteEpisode } = intent;
  if (episode === undefined && absoluteEpisode === undefined) return true;
  const sameEpisode =
    episode !== undefined &&
    started.episode === episode &&
    (season === undefined || started.season === season);
  const sameAbsolute =
    absoluteEpisode !== undefined &&
    (started.absoluteEpisode === absoluteEpisode || started.episode === absoluteEpisode);
  return sameEpisode || sameAbsolute;
}
