export function withTimeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeoutSignal;

  const abortSignal = AbortSignal as typeof AbortSignal & {
    any?: (signals: AbortSignal[]) => AbortSignal;
  };
  if (abortSignal.any) return abortSignal.any([signal, timeoutSignal]);

  const controller = new AbortController();
  // Forward whichever reason fired — a bare abort() would lose the caller's
  // cancel reason AND the TimeoutError, both of which the resolve commit
  // policy reads off the signal.
  const abort = () => controller.abort(signal.aborted ? signal.reason : timeoutSignal.reason);
  if (signal.aborted || timeoutSignal.aborted) {
    abort();
    return controller.signal;
  }
  signal.addEventListener("abort", abort, { once: true });
  timeoutSignal.addEventListener("abort", abort, { once: true });
  return controller.signal;
}
