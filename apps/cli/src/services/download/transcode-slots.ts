// =============================================================================
// transcode-slots.ts — counting gate for CPU-bound download finalization.
//
// Queue workers fetch at `maxConcurrentDownloads` parallelism (network-bound),
// but every finished download then burns CPU locally: ffprobe decodes the
// artifact for duration validation, and yt-dlp's ffmpeg mux children often
// overlap when several downloads finish together. Uncapped ×5 workers, that
// finalization spikes every core at once. This gate caps concurrent
// finalizations at MAX_PARALLEL_TRANSCODES while queue concurrency is
// untouched — waiters queue FIFO and always release.
// =============================================================================

/** Max parallel local media finalizations (ffprobe decode + artifact publish). */
export const MAX_PARALLEL_TRANSCODES = 2;

export type TranscodeSlotGate = {
  /** Resolve when a slot frees; FIFO across waiters. */
  acquire(): Promise<() => void>;
  /** Current holders, for tests/diagnostics. */
  readonly held: number;
};

export function createTranscodeSlotGate(
  limit: number = MAX_PARALLEL_TRANSCODES,
): TranscodeSlotGate {
  const capacity = Math.max(1, Math.trunc(limit));
  let held = 0;
  const waiters: (() => void)[] = [];
  function release(): void {
    const next = waiters.shift();
    if (next) {
      // Slot transfers directly to the next waiter; held is unchanged.
      next();
      return;
    }
    held = Math.max(0, held - 1);
  }
  return {
    get held() {
      return held;
    },
    acquire(): Promise<() => void> {
      // One release per acquisition: a double release must not free a slot
      // another finalization is still holding.
      let released = false;
      const releaseOnce = () => {
        if (released) return;
        released = true;
        release();
      };
      if (held < capacity) {
        held += 1;
        return Promise.resolve(releaseOnce);
      }
      return new Promise<() => void>((resolve) => {
        waiters.push(() => resolve(releaseOnce));
      });
    },
  };
}
