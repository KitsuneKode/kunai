import type {
  ProviderCycleFailure,
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
