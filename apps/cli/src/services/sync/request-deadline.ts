import { syncCancelled, syncFailed, type SyncOutcome } from "./types";

/** How long one tracker request may run before it is abandoned. */
export const SYNC_REQUEST_TIMEOUT_MS = 15_000;

/**
 * A request-scoped signal that aborts on either the caller's signal or this
 * adapter's own deadline, plus the cleanup that must run afterwards.
 *
 * The two sources have to stay distinguishable: a caller abort is a
 * cancellation that releases the outbox claim untouched, while a deadline is a
 * retryable network failure. Collapsing them either burns retry attempts during
 * an orderly shutdown or silently drops work on a slow network.
 */
export interface RequestDeadline {
  readonly signal: AbortSignal;
  /** True when this deadline — not the caller — aborted the request. */
  timedOut(): boolean;
  release(): void;
}

export function startRequestDeadline(
  parent: AbortSignal,
  timeoutMs = SYNC_REQUEST_TIMEOUT_MS,
): RequestDeadline {
  const controller = new AbortController();
  let expired = false;

  const onTimeout = () => {
    expired = true;
    controller.abort(new Error("sync-request-timeout"));
  };
  const onParentAbort = () => controller.abort(parent.reason);

  const timer = setTimeout(onTimeout, timeoutMs);
  if (parent.aborted) onParentAbort();
  else parent.addEventListener("abort", onParentAbort, { once: true });

  return {
    signal: controller.signal,
    timedOut: () => expired,
    // Always paired with the request in a `finally`: an uncleared timer keeps
    // the process alive past shutdown, and a retained listener leaks one entry
    // per delivered row on a long-lived parent signal.
    release() {
      clearTimeout(timer);
      parent.removeEventListener("abort", onParentAbort);
    },
  };
}

/**
 * Classify a thrown request against its deadline.
 *
 * `shutdown` is distinguished from a plain caller abort by the reason the
 * service aborts with, so an orderly quit is never recorded as a user action.
 */
export function outcomeForAbortedRequest(
  parent: AbortSignal,
  deadline: RequestDeadline,
): SyncOutcome | null {
  if (deadline.timedOut()) return syncFailed("request-timeout", "network");
  if (!parent.aborted) return null;
  return syncCancelled(isShutdownReason(parent.reason) ? "shutdown" : "caller-aborted");
}

/** The sentinel `SyncService.shutdown()` aborts with. */
export const SYNC_SHUTDOWN_REASON = "sync-shutdown";

export function isShutdownReason(reason: unknown): boolean {
  return reason === SYNC_SHUTDOWN_REASON;
}
