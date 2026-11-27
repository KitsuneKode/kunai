// =============================================================================
// mpv-avsync-recovery.ts — bounded sustained-drift evidence for persistent mpv
//
// mpv already corrects small timing error by dropping or duplicating frames.
// This tracker only escalates drift that stays large across several samples,
// and it gives up instead of turning a broken decoder into a seek loop.
// =============================================================================

export const AVSYNC_DRIFT_LIMIT_SECONDS = 0.3;
export const AVSYNC_DRIFT_SAMPLES_REQUIRED = 3;
export const AVSYNC_DRIFT_SUSTAINED_MS = 300;
export const AVSYNC_RESYNC_COOLDOWN_MS = 5_000;
export const AVSYNC_RESTART_GRACE_MS = 1_000;
export const AVSYNC_POST_RESYNC_GIVE_UP_MS = 4_000;
export const AVSYNC_MAX_RESYNCS_PER_EPISODE = 2;

export type MpvAvsyncRecoveryGuards = {
  readonly enabled: boolean;
  readonly paused: boolean;
  readonly coreIdle: boolean;
  readonly live: boolean;
  readonly reconnecting: boolean;
  readonly resumeSeekPending: boolean;
  readonly outputStarted: boolean;
  readonly retired: boolean;
  readonly hasIpcSession: boolean;
  readonly hasSeekablePosition: boolean;
  readonly resyncInFlight: boolean;
};

export type MpvAvsyncRecoveryDecision =
  | { readonly kind: "none" }
  | {
      readonly kind: "resync";
      /** One-based corrective attempt inside this episode. */
      readonly attempt: number;
    }
  | {
      /** Recovery is disabled for the rest of this episode; mpv keeps its ordinary frame dropping. */
      readonly kind: "give-up";
      readonly reason: "drift-returned" | "budget-exhausted";
      readonly resyncCount: number;
    };

export type MpvAvsyncRecoveryOptions = {
  readonly now?: () => number;
  readonly restartGraceMs?: number;
  readonly postResyncGiveUpMs?: number;
  readonly maxResyncsPerEpisode?: number;
};

export type MpvAvsyncRecoverySnapshot = {
  readonly resyncCount: number;
  readonly exhausted: boolean;
  readonly overLimitSamples: number;
};

/**
 * Episode-scoped drift evidence and recovery budget.
 *
 * Wall-clock state (`now`) is injectable because the important behavior is
 * time-dependent: startup grace, cooldown, and quick failure after a resync.
 * mpv-owned pause/seek/cache booleans are never reset merely because a new
 * file started; they are updated only when mpv reports the property again.
 */
export class MpvAvsyncRecoveryTracker {
  private readonly now: () => number;
  private readonly restartGraceMs: number;
  private readonly postResyncGiveUpMs: number;
  private readonly maxResyncsPerEpisode: number;
  private overLimitSamples = 0;
  private driftFirstObservedAt = 0;
  private outputStartedAt: number | null = null;
  private resyncCount = 0;
  private lastResyncAt: number | null = null;
  private recoveryExhausted = false;
  private seeking = false;
  private pausedForCache = false;
  private kunaiSeekInFlight = 0;

  constructor(options: MpvAvsyncRecoveryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.restartGraceMs = options.restartGraceMs ?? AVSYNC_RESTART_GRACE_MS;
    this.postResyncGiveUpMs = options.postResyncGiveUpMs ?? AVSYNC_POST_RESYNC_GIVE_UP_MS;
    this.maxResyncsPerEpisode = options.maxResyncsPerEpisode ?? AVSYNC_MAX_RESYNCS_PER_EPISODE;
  }

  /** Start a new file/episode budget and drop evidence left by the old one. */
  restartEpisode(): void {
    this.clearEvidence();
    this.outputStartedAt = null;
    this.resyncCount = 0;
    this.lastResyncAt = null;
    this.recoveryExhausted = false;
  }

  /**
   * Playback output restarted. This is deliberately not episode creation: a
   * slow network may otherwise consume the whole grace before the first frame.
   */
  noteOutputStarted(): void {
    this.outputStartedAt = this.now();
    this.clearEvidence();
  }

  clearEvidence(): void {
    this.overLimitSamples = 0;
    this.driftFirstObservedAt = 0;
  }

  /** mpv's seeking property. Any seek transition invalidates older drift. */
  noteSeeking(active: boolean): void {
    if (active || active !== this.seeking) this.clearEvidence();
    this.seeking = active;
  }

  /** mpv's paused-for-cache property. Cache stalls are not decoder drift. */
  notePausedForCache(active: boolean): void {
    if (active || active !== this.pausedForCache) this.clearEvidence();
    this.pausedForCache = active;
  }

  beginKunaiSeek(): void {
    this.kunaiSeekInFlight += 1;
    this.clearEvidence();
  }

  endKunaiSeek(): void {
    this.kunaiSeekInFlight = Math.max(0, this.kunaiSeekInFlight - 1);
    this.clearEvidence();
  }

  /** Current episode budget/state, exposed for focused tests and diagnostics. */
  snapshot(): MpvAvsyncRecoverySnapshot {
    return {
      resyncCount: this.resyncCount,
      exhausted: this.recoveryExhausted,
      overLimitSamples: this.overLimitSamples,
    };
  }

  /**
   * Consume one mpv `avsync` sample. A resync decision is synchronous and at
   * most once because the caller sets `resyncInFlight` before the next sample.
   */
  evaluate(
    driftSeconds: number,
    observedAt: number,
    guards: MpvAvsyncRecoveryGuards,
  ): MpvAvsyncRecoveryDecision {
    const suppressed =
      !guards.enabled ||
      guards.paused ||
      guards.coreIdle ||
      guards.live ||
      guards.reconnecting ||
      guards.resumeSeekPending ||
      guards.resyncInFlight ||
      guards.retired ||
      !guards.outputStarted ||
      !guards.hasIpcSession ||
      !guards.hasSeekablePosition ||
      this.seeking ||
      this.pausedForCache ||
      this.kunaiSeekInFlight > 0;
    if (suppressed || this.recoveryExhausted) {
      this.clearEvidence();
      return { kind: "none" };
    }

    const now = this.now();
    if (this.outputStartedAt === null || now - this.outputStartedAt < this.restartGraceMs) {
      this.clearEvidence();
      return { kind: "none" };
    }
    if (Math.abs(driftSeconds) <= AVSYNC_DRIFT_LIMIT_SECONDS) {
      this.clearEvidence();
      return { kind: "none" };
    }
    if (this.driftFirstObservedAt === 0) this.driftFirstObservedAt = observedAt;
    this.overLimitSamples += 1;
    if (
      this.overLimitSamples < AVSYNC_DRIFT_SAMPLES_REQUIRED ||
      observedAt - this.driftFirstObservedAt < AVSYNC_DRIFT_SUSTAINED_MS
    ) {
      return { kind: "none" };
    }

    // If drift is already sustained again within a few seconds of the last
    // corrective seek, the seek did not fix the pipeline. mpv's ordinary frame
    // dropping is a better outcome than seeking for the rest of the episode.
    if (this.lastResyncAt !== null && observedAt - this.lastResyncAt < this.postResyncGiveUpMs) {
      this.recoveryExhausted = true;
      this.clearEvidence();
      return { kind: "give-up", reason: "drift-returned", resyncCount: this.resyncCount };
    }
    if (this.lastResyncAt !== null && now - this.lastResyncAt < AVSYNC_RESYNC_COOLDOWN_MS) {
      return { kind: "none" };
    }
    if (this.resyncCount >= this.maxResyncsPerEpisode) {
      this.recoveryExhausted = true;
      this.clearEvidence();
      return { kind: "give-up", reason: "budget-exhausted", resyncCount: this.resyncCount };
    }

    this.resyncCount += 1;
    this.lastResyncAt = now;
    this.clearEvidence();
    return { kind: "resync", attempt: this.resyncCount };
  }
}
