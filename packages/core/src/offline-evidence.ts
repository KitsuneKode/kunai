import type { ProviderFailure, ProviderId } from "@kunai/types";

import { isOfflineNetworkFailure } from "./provider-failure-classifier";

/**
 * How confident we are that the *machine* has no network, as opposed to one
 * provider's domain being unreachable.
 */
export type OfflineEvidenceVerdict = "online" | "suspect" | "offline";

export const DEFAULT_CONSECUTIVE_OFFLINE_THRESHOLD = 2;

/**
 * Accumulates offline evidence across providers.
 *
 * `isOfflineNetworkFailure` matches substrings in an error message, so a single
 * hit proves almost nothing: a DNS hiccup on one provider's domain looks
 * identical to a dead uplink. Evidence only becomes a verdict once *distinct*
 * providers — meaning distinct domains — fail the same way back to back.
 *
 * Tracking a set of provider ids rather than a counter is deliberate: retrying
 * the same unreachable host must not accumulate evidence about the uplink.
 *
 * This is the seam a real reachability probe replaces later. Callers depend on
 * the verdict, not on message matching.
 */
export class OfflineEvidenceTracker {
  private readonly threshold: number;
  private readonly providersWithEvidence = new Set<ProviderId>();

  constructor(threshold: number = DEFAULT_CONSECUTIVE_OFFLINE_THRESHOLD) {
    this.threshold = Math.max(1, Math.floor(threshold));
  }

  get verdict(): OfflineEvidenceVerdict {
    if (this.providersWithEvidence.size === 0) return "online";
    return this.providersWithEvidence.size >= this.threshold ? "offline" : "suspect";
  }

  /** Distinct providers that have shown offline evidence since the last reset. */
  get evidenceCount(): number {
    return this.providersWithEvidence.size;
  }

  /** Any completed exchange proves the uplink works — discard prior evidence. */
  recordReachable(): void {
    this.providersWithEvidence.clear();
  }

  record(
    providerId: ProviderId,
    failure: Pick<ProviderFailure, "code" | "message">,
  ): OfflineEvidenceVerdict {
    if (!isOfflineNetworkFailure(failure)) {
      this.recordReachable();
      return "online";
    }
    this.providersWithEvidence.add(providerId);
    return this.verdict;
  }
}
