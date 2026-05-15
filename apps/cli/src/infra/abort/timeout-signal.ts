export function withTimeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeoutSignal;

  const abortSignal = AbortSignal as typeof AbortSignal & {
    any?: (signals: AbortSignal[]) => AbortSignal;
  };
  if (abortSignal.any) return abortSignal.any([signal, timeoutSignal]);

  return signal;
}
