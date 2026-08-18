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
  const abortSignal = AbortSignal as AbortSignalConstructorWithAny;
  if (abortSignal.any) return abortSignal.any([signal, timeoutSignal]);

  // Manual combine fallback so the timeout is never dropped.
  const controller = new AbortController();
  const abort = (source: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(source.reason);
  };
  if (signal.aborted) abort(signal);
  if (timeoutSignal.aborted) abort(timeoutSignal);
  signal.addEventListener("abort", () => abort(signal), { once: true });
  timeoutSignal.addEventListener("abort", () => abort(timeoutSignal), { once: true });
  return controller.signal;
}
