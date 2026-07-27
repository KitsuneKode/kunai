import type { EndpointHealthPort } from "@kunai/types";

/**
 * Why an attempt's signal aborted.
 *
 * The engine aborts a provider attempt for two very different reasons, and
 * endpoint health must not treat them alike:
 *
 * - the attempt exceeded its own timeout, which *is* evidence about the
 *   endpoint, or
 * - something cancelled the attempt from outside — the user quit, or hedged
 *   fallback took a winner and dropped the losers.
 *
 * Only the first is the endpoint's fault. Distinguishing them by class keeps
 * that decision explicit instead of matching on an error message.
 */
export class ProviderAttemptTimeoutError extends Error {
  constructor(message = "provider resolve timeout") {
    super(message);
    this.name = "ProviderAttemptTimeoutError";
  }
}

/**
 * Was this attempt cancelled from outside, rather than timing out on its own?
 *
 * An unaborted signal is not a cancellation. An abort whose reason is the
 * attempt timeout is the endpoint's fault. Everything else — an explicit
 * `ProviderResolveAbortError`, a user-supplied reason, or no reason at all —
 * is treated as cancellation, because we cannot attribute it to the endpoint.
 */
export function isCancellationAbort(signal: AbortSignal | undefined): boolean {
  if (!signal?.aborted) return false;
  return !(signal.reason instanceof ProviderAttemptTimeoutError);
}

/**
 * Drop endpoint-health *failure* writes issued after a cancellation.
 *
 * Providers record health from inside their own resolve, and they were written
 * when an abort meant "the user quit" — rare, and not worth reasoning about.
 * Hedged fallback changed that: it aborts the slower candidate on every race it
 * loses, so a provider that did nothing wrong now lands in its own catch block
 * and reports a failure. Those writes are not free — a `server-error` on two
 * distinct titles quarantines the endpoint for an hour, persisted — so hedging
 * would steadily quarantine healthy-but-slower endpoints purely for losing a
 * race we started.
 *
 * The guard lives here, at the one seam every provider's runtime context is
 * built from, rather than in each provider's catch blocks: the rule is a
 * property of cancellation, not of any one provider, and a per-provider fix
 * would have to be repeated (and kept correct) in every scraper we add.
 *
 * `shouldTry` and `recordSuccess` pass through untouched. A success observed
 * before the cancellation really did happen, and reads have no side effects.
 */
export function guardEndpointHealthAgainstCancellation(
  port: EndpointHealthPort,
  signal: AbortSignal | undefined,
): EndpointHealthPort {
  return {
    shouldTry: (providerId, endpoint) => port.shouldTry(providerId, endpoint),
    recordSuccess: (providerId, endpoint) => port.recordSuccess(providerId, endpoint),
    recordFailure: (providerId, endpoint, info) => {
      if (isCancellationAbort(signal)) return;
      port.recordFailure(providerId, endpoint, info);
    },
  };
}
