export {
  combineAbortSignals,
  combineAbortSignalsManually,
  createDeadlineSignal,
  createTimeoutSignal,
  type DeadlineSignal,
  type DeadlineSignalOptions,
} from "@kunai/core";

/**
 * A wait that ends early when the caller's signal aborts — never resolves
 * *after* the deadline, only before. A bare `setTimeout` retry makes a cancel
 * wait out the full delay; here the abort listener clears the timer and frees
 * the loop immediately.
 */
export function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal || ms <= 0) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(ms, 0)));
  }
  if (signal.aborted) return Promise.resolve();
  const { promise, resolve } = Promise.withResolvers<void>();
  // One exit for both the timer and the abort, so the listener and the timer
  // are always both released.
  const finish = () => {
    clearTimeout(timer);
    signal.removeEventListener("abort", finish);
    resolve();
  };
  const timer = setTimeout(finish, ms);
  signal.addEventListener("abort", finish, { once: true });
  return promise;
}
