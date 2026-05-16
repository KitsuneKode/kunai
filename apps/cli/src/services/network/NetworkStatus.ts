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

const NETWORK_ERROR_PATTERNS = [
  "enotfound",
  "eai_again",
  "econnrefused",
  "enetunreach",
  "network is unreachable",
  "err_internet_disconnected",
  "err_name_not_resolved",
  "dns",
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
