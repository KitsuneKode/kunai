export type AutoplayAdvanceCountdownResult = "continue" | "cancelled" | "skipped";

export async function runAutoplayAdvanceCountdown(options: {
  readonly seconds: number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly onTick: (remainingSeconds: number) => void;
  readonly isCancelled: () => boolean;
  readonly shouldSkip?: () => boolean;
  readonly signal?: AbortSignal;
}): Promise<AutoplayAdvanceCountdownResult> {
  const seconds = Math.max(0, Math.floor(options.seconds));
  for (let remaining = seconds; remaining > 0; remaining--) {
    if (options.signal?.aborted || options.isCancelled()) return "cancelled";
    options.onTick(remaining);
    if (options.shouldSkip?.()) return "skipped";
    await options.sleep(1_000);
    if (options.shouldSkip?.()) return "skipped";
  }
  if (options.signal?.aborted || options.isCancelled()) return "cancelled";
  return "continue";
}
