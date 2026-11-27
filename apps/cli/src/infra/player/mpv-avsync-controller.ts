// =============================================================================
// mpv-avsync-controller.ts — persistent-session wiring for bounded A/V repair
//
// The pure tracker decides whether drift evidence justifies a same-position
// seek. This controller owns the mpv property flags, IPC seek suppression, and
// playback-event reporting that connect that decision to PersistentMpvSession.
// =============================================================================

import { dbg } from "@/logger";
import { isJsonNumber } from "@kunai/types";

import { MpvAvsyncRecoveryTracker } from "./mpv-avsync-recovery";
import type { MpvIpcSession } from "./mpv-ipc";
import type { PlayerPlaybackEvent } from "./PlayerService";

export type MpvAvsyncControllerDeps = {
  readonly now?: () => number;
  readonly enabled: () => boolean;
  readonly live: () => boolean;
  readonly reconnecting: () => boolean;
  readonly resumeSeekPending: () => boolean;
  readonly outputStarted: () => boolean;
  readonly retired: () => boolean;
  readonly ipcSession: () => MpvIpcSession | null;
  readonly positionSeconds: () => number;
  readonly emit: (event: PlayerPlaybackEvent) => void;
};

export class MpvAvsyncController {
  private readonly tracker: MpvAvsyncRecoveryTracker;
  private paused = false;
  private seeking = false;
  private coreIdle = false;
  private resyncInFlight = false;

  constructor(private readonly deps: MpvAvsyncControllerDeps) {
    this.tracker = new MpvAvsyncRecoveryTracker({ now: deps.now });
  }

  restartEpisode(): void {
    this.tracker.restartEpisode();
  }

  /** mpv restarted output after startup, a reload, or a seek. */
  notePlaybackRestart(): void {
    this.tracker.noteOutputStarted();
  }

  /** Consume the persistent-session properties this controller owns. */
  observeProperty(update: { name: string; value: unknown; observedAt: number }): void {
    if (update.name === "pause") {
      this.paused = update.value === true;
      return;
    }
    if (update.name === "seeking") {
      this.seeking = update.value === true;
      this.tracker.noteSeeking(this.seeking);
      return;
    }
    if (update.name === "paused-for-cache") {
      this.tracker.notePausedForCache(update.value === true);
      return;
    }
    if (update.name === "core-idle") {
      this.coreIdle = update.value === true;
      return;
    }
    if (
      (update.name === "vo-configured" && update.value === true) ||
      (update.name === "video-out-params" && update.value !== null && update.value !== undefined)
    ) {
      this.notePlaybackRestart();
      return;
    }
    if (update.name !== "avsync") return;
    if (!isJsonNumber(update.value) || !Number.isFinite(update.value)) {
      this.tracker.clearEvidence();
      return;
    }
    this.evaluateDrift(update.value, update.observedAt);
  }

  /** Send one Kunai-owned seek while keeping drift evidence suppressed for its duration. */
  async sendKunaiSeek(session: MpvIpcSession, positionSeconds: number, timeoutMs: number) {
    this.tracker.beginKunaiSeek();
    try {
      return await session.send(["seek", positionSeconds, "absolute"], timeoutMs);
    } finally {
      this.tracker.endKunaiSeek();
    }
  }

  private evaluateDrift(driftSeconds: number, observedAt: number): void {
    const session = this.deps.ipcSession();
    const decision = this.tracker.evaluate(driftSeconds, observedAt, {
      enabled: this.deps.enabled(),
      paused: this.paused,
      coreIdle: this.coreIdle,
      live: this.deps.live(),
      reconnecting: this.deps.reconnecting(),
      resumeSeekPending: this.deps.resumeSeekPending(),
      outputStarted: this.deps.outputStarted(),
      retired: this.deps.retired(),
      hasIpcSession: session !== null,
      resyncInFlight: this.resyncInFlight,
    });
    if (decision.kind === "give-up") {
      dbg("mpv-ipc", "avsync-recovery-exhausted", {
        reason: decision.reason,
        resyncCount: decision.resyncCount,
      });
      this.deps.emit({
        type: "avsync-recovery-exhausted",
        reason: decision.reason,
        resyncCount: decision.resyncCount,
      });
      return;
    }
    if (decision.kind !== "resync") return;

    const position = this.deps.positionSeconds();
    if (position <= 0 || !session) return;
    this.resyncInFlight = true;
    dbg("mpv-ipc", "avsync-resync", {
      positionSeconds: position,
      driftSeconds,
      attempt: decision.attempt,
    });
    this.deps.emit({
      type: "avsync-resync",
      positionSeconds: position,
      driftSeconds,
      attempt: decision.attempt,
    });
    void this.sendKunaiSeek(session, position, 1_000)
      .catch(() => {})
      .finally(() => {
        this.resyncInFlight = false;
      });
  }
}
