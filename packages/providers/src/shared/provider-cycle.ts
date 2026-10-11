import type {
  ProviderCycleFailure,
  ProviderCycleResult,
  ProviderResolveResult,
  ProviderTraceEvent,
  ResolveErrorCode,
} from "@kunai/types";

export function appendCycleEventsToResult(
  result: ProviderResolveResult,
  events: readonly ProviderTraceEvent[],
): ProviderResolveResult {
  if (events.length === 0) return result;
  return {
    ...result,
    trace: {
      ...result.trace,
      events: [...(result.trace.events ?? []), ...events],
    },
  };
}

export function findLastCycleFailure(
  attempts: readonly { readonly failure?: ProviderCycleFailure }[],
): ProviderCycleFailure | undefined {
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    const failure = attempts[index]?.failure;
    if (failure) return failure;
  }
  return undefined;
}

/**
 * `runProviderCycle` can end with zero attempts: every candidate was skipped
 * by endpoint quarantine. `findLastCycleFailure` then returns undefined and a
 * call site's generic "exhausted" message would lie — nothing was attempted.
 * Name the quarantine so the failure reads as the transient state it is.
 */
export interface CycleExhaustionOutcome {
  readonly code: ResolveErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export function cycleExhaustionFailure(
  cycleResult: Pick<ProviderCycleResult<unknown>, "attempts" | "stopReason">,
  exhaustedMessage: string,
  exhaustedRetryable = true,
): CycleExhaustionOutcome {
  const cycleFailure = findLastCycleFailure(cycleResult.attempts);
  if (cycleFailure) {
    return {
      code: providerFailureCodeFromCycleFailure(cycleFailure.failureClass),
      message: cycleFailure.message,
      retryable: cycleFailure.retryable,
    };
  }
  if (cycleResult.stopReason === "all-quarantined") {
    return {
      code: "provider-unavailable",
      message:
        "Every source is quarantined by recent failures; they rejoin automatically as health recovers",
      retryable: true,
    };
  }
  return { code: "not-found", message: exhaustedMessage, retryable: exhaustedRetryable };
}

export function providerFailureCodeFromCycleFailure(
  failureClass: ProviderCycleFailure["failureClass"],
): ResolveErrorCode {
  switch (failureClass) {
    case "candidate-timeout":
      return "timeout";
    case "candidate-network":
      return "network-error";
    case "candidate-empty":
      return "not-found";
    case "candidate-expired":
      return "expired";
    case "candidate-blocked":
      return "blocked";
    case "candidate-rate-limited":
      return "rate-limited";
    case "candidate-server-error":
      return "provider-unavailable";
    case "candidate-parse":
      return "parse-failed";
    case "candidate-unsupported":
      return "unsupported-title";
    case "candidate-user-cancelled":
      return "cancelled";
    case "candidate-unknown":
    default:
      return "unknown";
  }
}
