type AbortSignalConstructorWithAny = typeof AbortSignal & {
  readonly any?: (signals: readonly AbortSignal[]) => AbortSignal;
};

/** Injectable timer surface for deterministic tests with zero real sleeps. */
export interface TimeoutTimers<THandle = unknown> {
  readonly setTimeout: (callback: () => void, ms: number) => THandle;
  readonly clearTimeout: (handle: THandle) => void;
}

export interface DeadlineSignalOptions<THandle = unknown> {
  /** Custom abort reason when the deadline expires; defaults to a `TimeoutError` DOMException. */
  readonly reason?: unknown;
  readonly timers?: TimeoutTimers<THandle>;
}

/**
 * A request-scoped signal combining an optional caller signal with a deadline
 * timer, paired with an idempotent `release()` that clears the timer and
 * detaches any parent listener once the operation settles.
 */
export interface DeadlineSignal {
  readonly signal: AbortSignal;
  /** True when this deadline — not the caller — aborted the signal. */
  timedOut(): boolean;
  /** Clear the timer and detach the parent abort listener. Safe to call repeatedly. */
  release(): void;
}

/**
 * Combine an optional caller signal with a cancellable deadline timer.
 *
 * Preserves abort reasons from both sources (the caller's `signal.reason`, or
 * a `TimeoutError` DOMException / custom `reason` on timeout) and clears the
 * timer immediately when the caller aborts or `release()` is called in
 * `finally`. Prefer this over hand-rolled `setTimeout(() => controller.abort())`.
 */
export function createDeadlineSignal<THandle = unknown>(
  signal: AbortSignal | undefined,
  timeoutMs: number,
  options?: DeadlineSignalOptions<THandle>,
): DeadlineSignal {
  const controller = new AbortController();
  if (signal?.aborted) {
    controller.abort(signal.reason);
    return {
      signal: controller.signal,
      timedOut: () => false,
      release: () => {},
    };
  }

  let expired = false;
  let released = false;
  const customTimers = options?.timers;
  const timeoutReason =
    options?.reason !== undefined
      ? options.reason
      : new DOMException("The operation timed out.", "TimeoutError");

  let cancelTimer: () => void = () => {};

  const onParentAbort = () => {
    if (released || controller.signal.aborted) return;
    released = true;
    cancelTimer();
    controller.abort(signal?.reason);
  };

  const onTimeout = () => {
    if (released || controller.signal.aborted) return;
    released = true;
    expired = true;
    signal?.removeEventListener("abort", onParentAbort);
    controller.abort(timeoutReason);
  };

  const delayMs = Math.max(0, timeoutMs);
  if (customTimers) {
    const handle = customTimers.setTimeout(onTimeout, delayMs);
    cancelTimer = () => customTimers.clearTimeout(handle);
  } else {
    const handle = setTimeout(onTimeout, delayMs);
    cancelTimer = () => clearTimeout(handle);
  }
  signal?.addEventListener("abort", onParentAbort, { once: true });

  return {
    signal: controller.signal,
    timedOut: () => expired,
    release() {
      if (released) return;
      released = true;
      cancelTimer();
      signal?.removeEventListener("abort", onParentAbort);
    },
  };
}

/**
 * Combine a caller's cancellation with a per-request deadline when a single
 * `AbortSignal` is needed without a `finally` release block.
 *
 * `signal ?? AbortSignal.timeout(ms)` reads like it does this and does not: a
 * caller that passes a signal silently loses the deadline, so one hung upstream
 * holds the whole resolve open until something else gives up. Always combine.
 */
export function createTimeoutSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  if (signal?.aborted) return AbortSignal.abort(signal.reason);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeoutSignal;
  return combineAbortSignals([signal, timeoutSignal]);
}

/**
 * N-way combine. Never degrades to "just the first signal": without
 * `AbortSignal.any` the manual combiner keeps every member's cancel wired up
 * and forwards the winning signal's reason.
 */
export function combineAbortSignals(signals: readonly AbortSignal[]): AbortSignal {
  // SAFETY: `AbortSignal.any` is checked for presence before invocation so older runtimes fall back cleanly.
  const abortSignal = AbortSignal as AbortSignalConstructorWithAny;
  if (abortSignal.any) return abortSignal.any([...signals]);
  return combineAbortSignalsManually(signals);
}

/** Manual combine used when `AbortSignal.any` is unavailable. Exported for tests. */
export function combineAbortSignalsManually(signals: readonly AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  const listeners: Array<{ readonly signal: AbortSignal; readonly handler: () => void }> = [];

  const cleanup = () => {
    for (const entry of listeners) {
      entry.signal.removeEventListener("abort", entry.handler);
    }
    listeners.length = 0;
  };

  const abort = (source: AbortSignal) => {
    if (controller.signal.aborted) return;
    cleanup();
    controller.abort(source.reason);
  };

  for (const signal of signals) {
    if (signal.aborted) {
      abort(signal);
      break;
    }
    const handler = () => abort(signal);
    listeners.push({ signal, handler });
    signal.addEventListener("abort", handler, { once: true });
  }
  return controller.signal;
}
