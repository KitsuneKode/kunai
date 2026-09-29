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
 * Substrings that identify a transport failure with no HTTP response behind it.
 *
 * Every entry must be a phrase the *transport* emits. A bare token like `dns`
 * used to be in this list and it was a live hazard: any provider message that
 * happened to contain those three letters — a title echoed into an error, a URL
 * with `dns` in a path — classified as `offline`, and
 * `DEFAULT_CONSECUTINE_OFFLINE_THRESHOLD = 2` across two distinct providers
 * then halts every remaining live candidate, including working ones. The
 * resolver's actual phrasings are enumerated instead.
 */
const NETWORK_ERROR_PATTERNS = [
  "enotfound",
  "eai_again",
  "econnrefused",
  "enetunreach",
  "network is unreachable",
  "err_internet_disconnected",
  "err_name_not_resolved",
  "unable to connect",
  "failedtoopensocket",
  "was there a typo in the url or port",
  // curl: "Could not resolve host: …"
  "could not resolve host",
  // glibc resolver: "Name or service not known"
  "name or service not known",
  // Windows resolver and Bun: "no such host"
  "no such host",
  // undici / Node: "dns lookup failed"
  "dns lookup",
  "dns query",
];

export function classifyNetworkFailure(message: string): NetworkStatus {
  const normalized = message.toLowerCase();
  if (NETWORK_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern))) return "offline";
  if (normalized.includes("timeout") || normalized.includes("timed out")) return "limited";
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
