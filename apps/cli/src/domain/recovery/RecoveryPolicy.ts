import type { ProviderHealth } from "@kunai/types";

export type RecoveryMode = "guided" | "fallback-first" | "manual";

export type NetworkAvailability = "online" | "offline" | "limited" | "unknown";

export type RecoveryFailureClass =
  | "timeout"
  | "network"
  | "rate-limited"
  | "provider-empty"
  | "provider-parse"
  | "expired-stream"
  | "unsupported-title"
  | "missing-input"
  | "user-cancelled"
  | "runtime-missing"
  | "blocked"
  | "sub-dub-mismatch"
  | "title-episode-gap"
  | "unknown";

export type RecoveryIntent =
  | "automatic"
  | "explicit-provider"
  | "retry"
  | "refresh"
  | "fallback"
  | "cancel";

export type RecoveryDecision =
  | "use-cache"
  | "validate-cache"
  | "resolve-primary"
  | "retry-primary"
  | "auto-fallback"
  | "ask-user"
  | "stop-blocking"
  | "proceed-with-warning";

export type RecoveryPolicyInput = {
  readonly mode: RecoveryMode;
  readonly intent: RecoveryIntent;
  readonly network: NetworkAvailability;
  readonly providerHealth?: Pick<ProviderHealth, "status"> | null;
  readonly failureClass?: RecoveryFailureClass | null;
  readonly retryCount?: number;
  readonly fallbackCount?: number;
  readonly slowResolveMs?: number | null;
  readonly slowResolveThresholdMs?: number;
  readonly cache: "none" | "fresh" | "stale" | "validated" | "health-timeout" | "health-failed";
  readonly playableStreamAvailable?: boolean;
  readonly compatibleProviderAvailable?: boolean;
};

export type RecoveryPolicyDecision = {
  readonly decision: RecoveryDecision;
  readonly reason:
    | "cache-fresh"
    | "cache-stale"
    | "cache-health-timeout-playable"
    | "cache-health-failed"
    | "user-cancelled"
    | "network-unavailable"
    | "runtime-blocker"
    | "explicit-down-provider-once"
    | "provider-health-down"
    | "transient-retry"
    | "fallback-first-slow"
    | "auto-fallback-failure"
    | "manual-or-ambiguous"
    | "normal-primary";
  readonly userVisible: boolean;
  readonly providerHealthPenalty: boolean;
};

const TRANSIENT_FAILURES = new Set<RecoveryFailureClass>(["timeout", "network"]);
const AUTO_FALLBACK_FAILURES = new Set<RecoveryFailureClass>([
  "timeout",
  "network",
  "rate-limited",
  "provider-empty",
  "provider-parse",
  "expired-stream",
]);
const BLOCKING_FAILURES = new Set<RecoveryFailureClass>([
  "missing-input",
  "runtime-missing",
  "user-cancelled",
]);

export function decideRecovery(input: RecoveryPolicyInput): RecoveryPolicyDecision {
  if (input.intent === "cancel" || input.failureClass === "user-cancelled") {
    return decision("stop-blocking", "user-cancelled", false, false);
  }

  if (input.network === "offline") {
    return decision("ask-user", "network-unavailable", true, false);
  }

  if (input.failureClass && BLOCKING_FAILURES.has(input.failureClass)) {
    return decision("stop-blocking", "runtime-blocker", true, false);
  }

  if (input.cache === "fresh" || input.cache === "validated") {
    return decision("use-cache", "cache-fresh", false, false);
  }

  if (input.cache === "stale") {
    return decision("validate-cache", "cache-stale", false, false);
  }

  if (input.cache === "health-failed") {
    return decision("resolve-primary", "cache-health-failed", true, false);
  }

  if (input.cache === "health-timeout" && input.playableStreamAvailable) {
    return decision("proceed-with-warning", "cache-health-timeout-playable", true, false);
  }

  if (
    input.providerHealth?.status === "down" &&
    input.intent === "explicit-provider" &&
    (input.retryCount ?? 0) === 0
  ) {
    return decision("resolve-primary", "explicit-down-provider-once", true, false);
  }

  if (input.providerHealth?.status === "down" && input.intent !== "explicit-provider") {
    return decision(
      input.compatibleProviderAvailable ? "auto-fallback" : "ask-user",
      "provider-health-down",
      true,
      false,
    );
  }

  if (
    input.failureClass &&
    TRANSIENT_FAILURES.has(input.failureClass) &&
    (input.retryCount ?? 0) < 1
  ) {
    return decision("retry-primary", "transient-retry", true, input.failureClass !== "network");
  }

  if (
    input.mode === "fallback-first" &&
    (input.fallbackCount ?? 0) < 1 &&
    input.compatibleProviderAvailable &&
    typeof input.slowResolveMs === "number" &&
    input.slowResolveMs >= (input.slowResolveThresholdMs ?? 15_000)
  ) {
    return decision("auto-fallback", "fallback-first-slow", true, false);
  }

  if (
    input.mode !== "manual" &&
    input.failureClass &&
    AUTO_FALLBACK_FAILURES.has(input.failureClass) &&
    input.compatibleProviderAvailable
  ) {
    return decision(
      "auto-fallback",
      "auto-fallback-failure",
      true,
      input.failureClass !== "network",
    );
  }

  if (input.failureClass || input.slowResolveMs) {
    return decision("ask-user", "manual-or-ambiguous", true, false);
  }

  return decision("resolve-primary", "normal-primary", false, false);
}

function decision(
  value: RecoveryDecision,
  reason: RecoveryPolicyDecision["reason"],
  userVisible: boolean,
  providerHealthPenalty: boolean,
): RecoveryPolicyDecision {
  return {
    decision: value,
    reason,
    userVisible,
    providerHealthPenalty,
  };
}
