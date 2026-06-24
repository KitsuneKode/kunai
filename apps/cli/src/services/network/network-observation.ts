import type { Container } from "@/container";

import { classifyNetworkFailure, type NetworkEvidence } from "./NetworkStatus";

/**
 * Feeds the live {@link NetworkStatusTracker} from real outbound IO. The tracker
 * starts optimistically "online" and self-corrects: the first connectivity-class
 * failure flips it offline/limited, the next success flips it back. Everything
 * downstream (source selection auto-fallback, the header offline alert, offline
 * hints) reads the tracker via `isNetworkAvailable`, so this is the single place
 * that turns those features from cosmetic into real.
 */
export type NetworkObserver = Pick<Container, "config" | "networkStatus">;

/** Record a confirmed reachable network from a successful online operation. */
export function recordNetworkSuccess(container: NetworkObserver, evidence: NetworkEvidence): void {
  // Manual offline mode is a user decision; never let live IO override it.
  if (container.config.offlineMode) return;
  container.networkStatus.recordSuccess(evidence);
}

/**
 * Record a network failure, but only when the error actually looks like a
 * connectivity problem. Provider 404s, empty results, parse errors, and aborts
 * return `"unknown"` from {@link classifyNetworkFailure} and must NOT mark the
 * whole session offline (that would cause status flapping on provider churn).
 */
export function recordNetworkFailure(
  container: NetworkObserver,
  error: unknown,
  evidence: NetworkEvidence,
): void {
  if (container.config.offlineMode) return;
  const message = error instanceof Error ? error.message : String(error);
  if (classifyNetworkFailure(message) === "unknown") return;
  container.networkStatus.recordFailure(message, evidence);
}

/**
 * Wrap a single online operation so its success/failure feeds the tracker.
 * Rethrows on error so caller behavior is unchanged — this only observes.
 */
export async function observeOnline<T>(
  container: NetworkObserver,
  evidence: NetworkEvidence,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    const result = await operation();
    recordNetworkSuccess(container, evidence);
    return result;
  } catch (error) {
    recordNetworkFailure(container, error, evidence);
    throw error;
  }
}

/**
 * Feed the tracker from a provider resolve result. A fresh/fallback stream proves
 * live connectivity; cache/prefetch hits do not (they can serve while offline).
 * A resolve that produced no stream only marks offline when its attempt failures
 * look like connectivity errors.
 */
export function observeResolveNetworkOutcome(
  container: NetworkObserver,
  resolveResult: {
    readonly stream: unknown | null;
    readonly provenance: string;
    readonly attempts: readonly { readonly failure?: { readonly message?: string } | null }[];
  },
): void {
  if (container.config.offlineMode) return;

  if (resolveResult.stream) {
    if (
      !resolveResult.provenance.startsWith("cache") &&
      resolveResult.provenance !== "prefetched"
    ) {
      container.networkStatus.recordSuccess("provider-error");
    }
    return;
  }

  const failureText = resolveResult.attempts
    .map((attempt) => attempt.failure?.message ?? "")
    .filter(Boolean)
    .join(" · ");
  if (!failureText) return;
  if (classifyNetworkFailure(failureText) === "unknown") return;
  container.networkStatus.recordFailure(failureText, "provider-error");
}
