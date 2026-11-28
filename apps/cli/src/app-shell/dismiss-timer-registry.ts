import { plainTimerAllowed } from "./plain-mode";

export type DismissTimerOperations = {
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
};

const defaultTimerOperations: DismissTimerOperations = {
  setTimeout(callback, delayMs) {
    const handle = setTimeout(callback, delayMs);
    // A dismissal must not keep the process alive after the shell exits.
    handle.unref?.();
    return handle;
  },
  clearTimeout(handle) {
    // SAFETY: schedule() stores the handle this setTimeout returned.
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export type DismissTimerRegistry = {
  readonly schedule: (callback: () => void, delayMs: number) => void;
  readonly dispose: () => void;
  /** Cancel every pending timer and run its dismissal now. */
  readonly flush: () => void;
};

export function createDismissTimerRegistry(
  timers: DismissTimerOperations = defaultTimerOperations,
): DismissTimerRegistry {
  const active = new Map<unknown, () => void>();

  return {
    schedule(callback, delayMs) {
      if (!plainTimerAllowed("decorative")) return;
      let handle: unknown;
      handle = timers.setTimeout(() => {
        active.delete(handle);
        callback();
      }, delayMs);
      active.set(handle, callback);
    },
    dispose() {
      for (const handle of active.keys()) timers.clearTimeout(handle);
      active.clear();
    },
    flush() {
      const pending = [...active];
      active.clear();
      for (const [handle, callback] of pending) {
        timers.clearTimeout(handle);
        callback();
      }
    },
  };
}

/**
 * Download-queued notes. They live in the container store, which outlives the
 * shell, so unmount dismisses them now (flush) rather than dropping the timer
 * and leaving the note up for a remount. The timer is unref'd.
 */
export const shellFeedbackTimers = createDismissTimerRegistry();
