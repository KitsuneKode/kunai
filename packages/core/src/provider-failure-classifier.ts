import type {
  ClassifiableProviderFailure,
  ProviderFailureClassification,
  ProviderFailureClass,
  ProviderFallbackPolicy,
  ResolveErrorCode,
} from "@kunai/types";

export function classifyProviderFailure(failure: unknown): ProviderFailureClassification {
  const normalized = normalizeProviderFailure(failure);
  const failureClass = classifyProviderFailureClass(normalized);
  const fallbackPolicy = fallbackPolicyForProviderFailureClass(failureClass, normalized);

  return {
    failureClass,
    fallbackPolicy,
    retryable: normalized.retryable ?? fallbackPolicy === "auto-fallback",
    userSummary: buildProviderFailureUserSummary(normalized.providerId, failureClass),
    developerDetail: buildProviderFailureDeveloperDetail(normalized),
  };
}

export function fallbackPolicyForProviderFailureClass(
  failureClass: ProviderFailureClass,
  failure?: ClassifiableProviderFailure,
): ProviderFallbackPolicy {
  if (failure?.retryable === false && !GUIDED_ACTION_PROVIDER_FAILURE_CLASSES.has(failureClass)) {
    return "no-fallback";
  }
  if (AUTO_FALLBACK_PROVIDER_FAILURE_CLASSES.has(failureClass)) return "auto-fallback";
  if (GUIDED_ACTION_PROVIDER_FAILURE_CLASSES.has(failureClass)) return "guided-action";
  return "no-fallback";
}

const AUTO_FALLBACK_PROVIDER_FAILURE_CLASSES = new Set<ProviderFailureClass>([
  "timeout",
  "network",
  "rate-limited",
  "provider-empty",
  "provider-parse",
  "expired-stream",
]);

const GUIDED_ACTION_PROVIDER_FAILURE_CLASSES = new Set<ProviderFailureClass>([
  "blocked",
  "sub-dub-mismatch",
  "title-episode-gap",
]);

function normalizeProviderFailure(failure: unknown): ClassifiableProviderFailure {
  if (isClassifiableProviderFailure(failure)) {
    if (isClassifiableProviderFailure(failure.failure)) return failure.failure;
    return failure;
  }

  if (failure instanceof Error) {
    return {
      code: providerFailureCodeFromMessage(failure.message),
      message: failure.message,
    };
  }

  return {
    code: "unknown",
    message: String(failure),
  };
}

function classifyProviderFailureClass(failure: ClassifiableProviderFailure): ProviderFailureClass {
  const code = failure.code;
  if (code === "timeout") return "timeout";
  if (code === "network-error" || code === "provider-unavailable") return "network";
  if (code === "rate-limited") return "rate-limited";
  if (code === "not-found") return "provider-empty";
  if (code === "parse-failed") return "provider-parse";
  if (code === "expired") return "expired-stream";
  if (code === "unsupported-title") return "unsupported-title";
  if (code === "runtime-missing") return "runtime-missing";
  if (code === "blocked") return "blocked";
  if (code === "cancelled") return "user-cancelled";

  const message = (failure.message ?? "").toLowerCase();
  if (message.includes("abort") || message.includes("cancel")) return "user-cancelled";
  if (message.includes("timeout") || message.includes("timed out")) return "timeout";
  if (message.includes("rate limit") || message.includes("429")) return "rate-limited";
  if (message.includes("403") || message.includes("blocked")) return "blocked";
  if (message.includes("subtitle") && message.includes("dub")) return "sub-dub-mismatch";
  if (message.includes("episode") && (message.includes("missing") || message.includes("gap"))) {
    return "title-episode-gap";
  }
  if (
    message.includes("empty") ||
    message.includes("no playable") ||
    message.includes("not found")
  ) {
    return "provider-empty";
  }
  if (message.includes("parse")) return "provider-parse";
  if (message.includes("network") || message.includes("fetch")) return "network";

  if (typeof failure.status === "number") {
    if (failure.status === 408 || failure.status === 504) return "timeout";
    if (failure.status === 429) return "rate-limited";
    if (failure.status === 401 || failure.status === 403) return "blocked";
    if (failure.status === 404) return "provider-empty";
    if (failure.status >= 500) return "network";
  }

  return "unknown";
}

function buildProviderFailureUserSummary(
  providerId: string | undefined,
  failureClass: ProviderFailureClass,
): string {
  const prefix = providerId ? `${formatProviderName(providerId)} ` : "Provider ";
  switch (failureClass) {
    case "timeout":
      return `${prefix}is taking longer than expected.`;
    case "network":
      return `${prefix}had a network issue.`;
    case "rate-limited":
      return `${prefix}is rate limiting requests.`;
    case "provider-empty":
      return `${prefix}did not return a playable stream.`;
    case "provider-parse":
      return `${prefix}returned data Kunai could not read.`;
    case "expired-stream":
      return `${prefix}returned an expired stream.`;
    case "blocked":
      return `${prefix}appears blocked right now.`;
    case "sub-dub-mismatch":
      return `${prefix}does not match the selected sub/dub preference.`;
    case "title-episode-gap":
      return `${prefix}does not have this episode available yet.`;
    case "runtime-missing":
      return "A required local runtime is missing.";
    case "missing-input":
      return "Kunai is missing required playback input.";
    case "user-cancelled":
      return "Playback resolution was cancelled.";
    case "unsupported-title":
      return `${prefix}does not support this title.`;
    case "unknown":
      return `${prefix}had an unexpected issue.`;
  }
}

function buildProviderFailureDeveloperDetail(failure: ClassifiableProviderFailure): string {
  const provider = failure.providerId ? `provider=${failure.providerId}` : "provider=unknown";
  const code = failure.code ? `code=${failure.code}` : "code=unknown";
  const retryable =
    typeof failure.retryable === "boolean" ? `retryable=${failure.retryable}` : "retryable=unknown";
  const message = failure.message
    ? `message=${truncateProviderFailureDetail(failure.message, 500)}`
    : "message=none";
  return `${provider} ${code} ${retryable} ${message}`;
}

function providerFailureCodeFromMessage(message: string): ResolveErrorCode | "unknown" {
  const lower = message.toLowerCase();
  if (lower.includes("abort") || lower.includes("cancel")) return "cancelled";
  if (lower.includes("timeout") || lower.includes("timed out")) return "timeout";
  if (lower.includes("runtime") && lower.includes("missing")) return "runtime-missing";
  return "unknown";
}

function isClassifiableProviderFailure(value: unknown): value is ClassifiableProviderFailure {
  return typeof value === "object" && value !== null;
}

function formatProviderName(providerId: string): string {
  return providerId
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function truncateProviderFailureDetail(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

export type {
  ClassifiableProviderFailure,
  ProviderFailureClassification,
  ProviderFailureClass,
  ProviderFallbackPolicy,
} from "@kunai/types";
