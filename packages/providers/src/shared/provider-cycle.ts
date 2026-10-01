import type {
  ProviderCycleFailure,
  ProviderFailure,
  ProviderId,
  ProviderResolveInput,
  ProviderResolveResult,
  ProviderTraceEvent,
  ResolveErrorCode,
} from "@kunai/types";

import { createExhaustedResult } from "./resolve-helpers";

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
 * Inverse of {@link providerFailureCodeFromCycleFailure}: a provider that
 * already classified a request-level failure (ProviderFailure.code) maps it
 * back to the cycle class so the thrown candidate failure keeps the real
 * cause instead of collapsing to `candidate-empty`.
 */
export function cycleFailureClassFromProviderCode(
  code: ResolveErrorCode,
): ProviderCycleFailure["failureClass"] {
  switch (code) {
    case "timeout":
      return "candidate-timeout";
    case "network-error":
      return "candidate-network";
    case "expired":
      return "candidate-expired";
    case "blocked":
      return "candidate-blocked";
    case "rate-limited":
      return "candidate-rate-limited";
    case "provider-unavailable":
      return "candidate-server-error";
    case "parse-failed":
      return "candidate-parse";
    case "unsupported-title":
      return "candidate-unsupported";
    case "cancelled":
      return "candidate-user-cancelled";
    default:
      return "candidate-empty";
  }
}

/**
 * The one way a dead provider cycle becomes an exhausted result.
 *
 * Every cycle provider used to hand-assemble this: find the terminal attempt
 * failure, map its class back to a ResolveErrorCode, fall back to a generic
 * "no playable source" when the cycle never ran, then call
 * createExhaustedResult. The assembly drifted once already — videasy kept the
 * generic candidate-empty over its classified detail — so the whole sequence
 * lives in one place now.
 */
export function cycleExhaustedResult(args: {
  readonly input: ProviderResolveInput;
  readonly context: Parameters<typeof createExhaustedResult>[1];
  readonly providerId: ProviderId;
  /** The cycle's attempts — the terminal classified failure rides the last one. */
  readonly attempts: readonly { readonly failure?: ProviderCycleFailure }[];
  /** Reported when the cycle never ran an attempt (all lanes pre-skipped). */
  readonly fallback: Omit<ProviderFailure, "providerId" | "at">;
  readonly evidence?: Parameters<typeof createExhaustedResult>[4];
}): ProviderResolveResult {
  const cycleFailure = findLastCycleFailure(args.attempts);
  const failure = cycleFailure
    ? {
        code: providerFailureCodeFromCycleFailure(cycleFailure.failureClass),
        message: cycleFailure.message,
        retryable: cycleFailure.retryable,
      }
    : args.fallback;
  return createExhaustedResult(args.input, args.context, args.providerId, failure, args.evidence);
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
