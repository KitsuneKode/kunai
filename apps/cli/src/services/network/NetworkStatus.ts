import { isOfflineNetworkFailure, isTransportNetworkFailure } from "@kunai/core";

export type NetworkStatus = "online" | "offline" | "limited" | "unknown";

export type NetworkEvidence =
  | "startup-probe"
  | "provider-error"
  | "search-error"
  | "poster-error"
  | "subtitle-error"
  | "manual-refresh";

export type NetworkSnapshot = {
  readonly status: NetworkStatus;
  readonly checkedAt: number;
  readonly evidence: NetworkEvidence;
  readonly message?: string;
};

export type NetworkUserHint = {
  readonly tone: "neutral" | "warning";
  readonly title: string;
  readonly detail: string;
  readonly actions: readonly ("offline-library" | "retry" | "diagnostics" | "back")[];
};

/**
 * Classify a thrown/recorded network message for the connectivity seam.
 *
 * The shared classifiers in `@kunai/core` own the signature lists now:
 * `isOfflineNetworkFailure` holds the uplink-evidence phrasings (resolver and
 * routing failures, plus Bun's collapsed connect vocabulary), and
 * `isTransportNetworkFailure` adds the endpoint-local transport deaths —
 * refused, reset, timeout, TLS. Evidence maps to `offline`; a transport
 * failure without evidence maps to `limited`, because a refused or reset
 * connection proves the host answered — the uplink worked. That also keeps a
 * single ECONNRESET from latching `Connectivity` into `offline`, which would
 * have blocked every online code path on one middlebox.
 *
 * Bare tokens stay banned: `dns` alone used to match titles and URLs, so the
 * shared list enumerates the phrasings transports actually emit.
 */
export function classifyNetworkFailure(message: string): NetworkStatus {
  const failure = { code: "network-error" as const, message };
  if (isOfflineNetworkFailure(failure)) return "offline";
  if (isTransportNetworkFailure(failure)) return "limited";
  return "unknown";
}

export function shouldShowNetworkUnavailableHint(input: {
  readonly snapshot: NetworkSnapshot | null | undefined;
  readonly context:
    | "online-search"
    | "playback-resolve"
    | "offline-library"
    | "offline-online-action";
}): boolean {
  if (input.snapshot?.status !== "offline") return false;
  return input.context !== "offline-library";
}

export function describeNetworkUnavailableAction(): string {
  return "Network unavailable · Open offline library or retry";
}

export function buildNetworkUserHint(input: {
  readonly snapshot: NetworkSnapshot | null | undefined;
  readonly context:
    | "online-search"
    | "playback-resolve"
    | "offline-library"
    | "offline-online-action";
}): NetworkUserHint | null {
  if (!input.snapshot) return null;
  if (input.context === "offline-library") return null;

  if (input.snapshot.status === "offline") {
    return {
      tone: "warning",
      title: "Internet unavailable",
      detail: "Online providers cannot be reached right now. Offline downloads are still playable.",
      actions:
        input.context === "offline-online-action"
          ? ["retry", "diagnostics", "back"]
          : ["offline-library", "retry", "diagnostics", "back"],
    };
  }

  if (input.snapshot.status === "limited") {
    return {
      tone: "neutral",
      title: "Connection looks slow",
      detail: "Kunai can retry online work or you can switch to saved offline titles.",
      actions: ["retry", "offline-library", "diagnostics", "back"],
    };
  }

  return null;
}
