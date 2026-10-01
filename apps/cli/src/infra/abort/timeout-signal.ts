export function withTimeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeoutSignal;

  const abortSignal = AbortSignal as typeof AbortSignal & {
    any?: (signals: AbortSignal[]) => AbortSignal;
  };
  if (abortSignal.any) return abortSignal.any([signal, timeoutSignal]);

  const controller = new AbortController();
  const listeners: Array<{ signal: AbortSignal; listener: () => void }> = [];
  const finish = () => {
    if (!controller.signal.aborted) controller.abort();
    for (const entry of listeners) {
      entry.signal.removeEventListener("abort", entry.listener);
    }
    listeners.length = 0;
  };
  if (signal.aborted || timeoutSignal.aborted) {
    finish();
    return controller.signal;
  }
  const onCaller = () => finish();
  const onTimeout = () => finish();
  listeners.push({ signal, listener: onCaller }, { signal: timeoutSignal, listener: onTimeout });
  signal.addEventListener("abort", onCaller, { once: true });
  timeoutSignal.addEventListener("abort", onTimeout, { once: true });
  return controller.signal;
}
