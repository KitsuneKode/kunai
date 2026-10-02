import { createResolveTrace, createTraceStep } from "@kunai/core";
import { ProviderHttpError } from "@kunai/types";
import type {
  CachePolicy,
  ProviderFailure,
  ProviderId,
  ProviderResolveInput,
  ProviderResolveResult,
  ProviderRuntimeContext,
  ProviderSourceCandidate,
  ProviderTraceEvent,
} from "@kunai/types";

export function createExhaustedResult(
  input: ProviderResolveInput,
  context: ProviderRuntimeContext,
  providerId: ProviderId,
  failure: Omit<ProviderFailure, "providerId" | "at">,
  evidence: {
    readonly cachePolicy?: CachePolicy;
    readonly events?: readonly ProviderTraceEvent[];
    readonly failures?: readonly ProviderFailure[];
    readonly sources?: readonly ProviderSourceCandidate[];
    readonly startedAt?: string;
  } = {},
): ProviderResolveResult {
  const at = context.now();
  const providerFailure: ProviderFailure = {
    providerId,
    at,
    ...failure,
  };

  const event: ProviderTraceEvent = {
    type: "provider:exhausted",
    at,
    providerId,
    message: providerFailure.message,
  };
  context.emit?.(event);

  // `failures[0]` is the de-facto headline — the engine throws it and the
  // inventory projection reads it. Lane detail must never bury the terminal
  // classification: a 502 seed outage reported by the last lane as "no
  // playable source" reads as not-found and poisons fallback decisions.
  const detail = evidence.failures ?? [];
  const alreadyRepresented = detail.some(
    (f) => f.code === providerFailure.code && f.message === providerFailure.message,
  );
  const failures = alreadyRepresented ? detail : [providerFailure, ...detail];
  const events = [...(evidence.events ?? []), event];
  const cachePolicy = evidence.cachePolicy ?? {
    ttlClass: "stream-manifest" as const,
    scope: "local" as const,
    keyParts: [providerId, "exhausted"],
  };

  return {
    status: "exhausted",
    providerId,
    sources: evidence.sources,
    streams: [],
    subtitles: [],
    cachePolicy,
    trace: createResolveTrace({
      title: input.title,
      episode: input.episode,
      providerId,
      cacheHit: false,
      runtime: "direct-http",
      startedAt: evidence.startedAt ?? at,
      endedAt: at,
      steps: [
        createTraceStep("provider", providerFailure.message, {
          providerId,
          attributes: { code: providerFailure.code },
        }),
      ],
      events,
      failures,
    }),
    failures,
    // A cancelled resolve is not evidence about the provider — the caller went
    // away, the upstream was never asked. Reporting it as a failure quietly
    // accumulated negative health for providers that lose hedge races or get
    // aborted when the user backs out. `unsupported-title` is the same: it says
    // this title is out of scope, not that the provider is unhealthy.
    ...(isProviderHealthNeutral(providerFailure.code)
      ? null
      : {
          healthDelta: {
            providerId,
            outcome: "failure" as const,
            at,
          },
        }),
  };
}

/** Failure codes that describe the request, not the provider's health. */
function isProviderHealthNeutral(code: ProviderFailure["code"]): boolean {
  return code === "cancelled" || code === "unsupported-title";
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- boundary probe: this function is what parses the caught value
export function isProviderTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "TimeoutError" || error.name === "AbortError") return true;
  return /timed out|timeout/i.test(error.message);
}

export interface ClassifiedFetchFailure {
  readonly code: ProviderFailure["code"];
  readonly retryable: boolean;
}

/**
 * Classify a thrown fetch/resolve error into failure-ledger terms without
 * string-matching: a ProviderHttpError already carries the right code and
 * retryability (403 → blocked, 429 → rate-limited, 5xx → provider-unavailable),
 * so flattening it to `network-error` would retry-storm throttled endpoints
 * and mislead fallback ordering. Everything else stays a generic,
 * retryable network failure.
 */
export function classifyProviderFetchFailure(error: Error | undefined): ClassifiedFetchFailure {
  if (error instanceof ProviderHttpError) {
    return { code: error.code, retryable: error.retryable };
  }
  if (error !== undefined && isProviderTimeoutError(error)) {
    return { code: "timeout", retryable: true };
  }
  return { code: "network-error", retryable: true };
}

export function emitTraceEvent(
  events: ProviderTraceEvent[],
  context: ProviderRuntimeContext | undefined,
  event: Omit<ProviderTraceEvent, "at">,
): void {
  const fullEvent: ProviderTraceEvent = {
    ...event,
    at: context?.now() ?? new Date().toISOString(),
  };
  events.push(fullEvent);
  context?.emit?.(fullEvent);
}
