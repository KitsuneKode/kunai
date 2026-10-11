type AbortSignalConstructorWithAny = typeof AbortSignal & {
  readonly any?: (signals: readonly AbortSignal[]) => AbortSignal;
};

/**
 * Combine a caller's cancellation with a per-request deadline.
 *
 * `signal ?? AbortSignal.timeout(ms)` reads like it does this and does not: a
 * caller that passes a signal silently loses the deadline, so one hung upstream
 * holds the whole resolve open until something else gives up. Always combine.
 */
export function createTimeoutSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeoutSignal;
  return combineAbortSignals([signal, timeoutSignal]);
}

/**
 * N-way combine. Never degrades to "just the first signal": without
 * `AbortSignal.any` the manual combiner keeps every member's cancel wired up.
 */
export function combineAbortSignals(signals: readonly AbortSignal[]): AbortSignal {
  const abortSignal = AbortSignal as AbortSignalConstructorWithAny;
  if (abortSignal.any) return abortSignal.any([...signals]);
  return combineAbortSignalsManually(signals);
}

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

/** Manual combine used when `AbortSignal.any` is unavailable. Exported for tests. */
export function combineAbortSignalsManually(signals: readonly AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  const abort = (source: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(source.reason);
  };
  for (const signal of signals) {
    if (signal.aborted) {
      abort(signal);
      break;
    }
    signal.addEventListener("abort", () => abort(signal), { once: true });
  }
  return controller.signal;
}
