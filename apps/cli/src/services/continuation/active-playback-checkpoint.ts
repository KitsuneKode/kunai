// =============================================================================
// ActivePlaybackCheckpoint — session-scoped registry for exactly one active
// playback checkpoint callback. PlaybackPhase registers the history-ledger
// checkpoint while mpv runs; the shutdown coordinator flushes it before mpv
// is released so the latest resume position always lands, even on Ctrl+C.
// =============================================================================

export class ActivePlaybackCheckpoint {
  private registration = 0;
  private checkpoint: (() => void) | null = null;

  /**
   * Register the active checkpoint, replacing any prior one. The returned
   * unregister function is registration-scoped: a stale unregister cannot
   * clear a newer callback.
   */
  register(checkpoint: () => void): () => void {
    const registration = ++this.registration;
    this.checkpoint = checkpoint;
    return () => {
      if (this.registration === registration) this.checkpoint = null;
    };
  }

  flush(): void {
    this.checkpoint?.();
  }

  clear(): void {
    this.registration += 1;
    this.checkpoint = null;
  }
}
