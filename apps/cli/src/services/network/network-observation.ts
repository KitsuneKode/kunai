import type { Container } from "@/container";

import { classifyNetworkFailure, type NetworkEvidence } from "./NetworkStatus";

/**
 * Feeds the live {@link Connectivity} seam from real outbound IO.
 */
export type NetworkObserver = Pick<Container, "connectivity">;

let boundObserver: NetworkObserver | undefined;

/** Binds the active container connectivity seam for modules without direct container access. */
export function bindNetworkObserver(observer: NetworkObserver | undefined): void {
  boundObserver = observer;
}

export function getBoundNetworkObserver(): NetworkObserver | undefined {
  return boundObserver;
}

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

export async function observeOnlineIfBound<T>(
  evidence: NetworkEvidence,
  operation: () => Promise<T>,
): Promise<T> {
  const observer = getBoundNetworkObserver();
  if (!observer) return operation();
  return observeOnline(observer, evidence, operation);
}

function isNetworkBackedResolveProvenance(provenance: string): boolean {
  return provenance === "fresh" || provenance === "cache-refetched";
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
    if (isNetworkBackedResolveProvenance(resolveResult.provenance)) {
      recordNetworkSuccess(container, "provider-error");
    }
    return;
  }

  const failureText = resolveResult.attempts
    .map((attempt) => attempt.failure?.message ?? "")
    .filter(Boolean)
    .join(" · ");
  if (!failureText) return;
  if (classifyNetworkFailure(failureText) === "unknown") return;
  recordNetworkFailure(container, failureText, "provider-error");
}
