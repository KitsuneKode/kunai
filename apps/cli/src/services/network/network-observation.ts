import type { Container } from "@/container";

import { classifyNetworkFailure, type NetworkEvidence } from "./NetworkStatus";

/**
 * Feeds the live {@link Connectivity} seam from real outbound IO.
 */
export type NetworkObserver = Pick<Container, "connectivity">;

export function recordNetworkSuccess(container: NetworkObserver, evidence: NetworkEvidence): void {
  container.connectivity.recordSuccess(evidence);
}

export function recordNetworkFailure(
  container: NetworkObserver,
  error: unknown,
  evidence: NetworkEvidence,
): void {
  const message = error instanceof Error ? error.message : String(error);
  if (classifyNetworkFailure(message) === "unknown") return;
  container.connectivity.recordFailure(message, evidence);
}

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

export function observeResolveNetworkOutcome(
  container: NetworkObserver,
  resolveResult: {
    readonly stream: unknown | null;
    readonly provenance: string;
    readonly attempts: readonly { readonly failure?: { readonly message?: string } | null }[];
  },
): void {
  if (resolveResult.stream) {
    if (
      !resolveResult.provenance.startsWith("cache") &&
      resolveResult.provenance !== "prefetched"
    ) {
      container.connectivity.recordSuccess("provider-error");
    }
    return;
  }

  const failureText = resolveResult.attempts
    .map((attempt) => attempt.failure?.message ?? "")
    .filter(Boolean)
    .join(" · ");
  if (!failureText) return;
  if (classifyNetworkFailure(failureText) === "unknown") return;
  container.connectivity.recordFailure(failureText, "provider-error");
}
