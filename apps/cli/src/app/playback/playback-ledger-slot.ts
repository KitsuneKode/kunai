// =============================================================================
// Playback history ledger slot
//
// The one history ledger an active playback writes through, plus its
// shutdown-checkpoint registration. A PlaybackPhase owns one slot; the player
// launch fills it, progress hooks write through it, and the episode-end path
// either finalizes it or discards it.
// =============================================================================

import type { PlaybackHistoryLedger } from "@/services/continuation/playback-history-ledger";

export class PlaybackLedgerSlot {
  private ledger: PlaybackHistoryLedger | null = null;
  private unregisterCheckpoint: (() => void) | null = null;

  /** The ledger of the playback in flight, or null when none is recording. */
  get current(): PlaybackHistoryLedger | null {
    return this.ledger;
  }

  /**
   * Make `ledger` the active one. The checkpoint callback reads the slot at
   * flush time, so a coordinated shutdown checkpoints whichever ledger is
   * current then — and nothing once it has been released.
   */
  attach(
    ledger: PlaybackHistoryLedger,
    registerCheckpoint: (checkpoint: () => void) => () => void,
  ): void {
    this.ledger = ledger;
    this.unregisterCheckpoint = registerCheckpoint(() => {
      this.ledger?.checkpoint();
    });
  }

  /**
   * Forget the ledger without discarding it (it has been finalized) and drop
   * this slot's checkpoint registration — registration-scoped, never a global
   * clear, which would wipe a newer playback's callback.
   */
  release(): void {
    this.ledger = null;
    this.unregisterCheckpoint?.();
    this.unregisterCheckpoint = null;
  }

  /**
   * Rejected / aborted / skipped-history sessions must not survive coordinated
   * shutdown flush: discard pending writes, then release.
   */
  discard(): void {
    this.ledger?.discard();
    this.release();
  }
}
