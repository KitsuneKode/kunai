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
