import { createDeadlineSignal, type DeadlineSignal } from "@kunai/core";

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
export type RequestDeadline = DeadlineSignal;

export function startRequestDeadline(
  parent: AbortSignal,
  timeoutMs = SYNC_REQUEST_TIMEOUT_MS,
): RequestDeadline {
  return createDeadlineSignal(parent, timeoutMs, {
    reason: new Error("sync-request-timeout"),
  });
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
