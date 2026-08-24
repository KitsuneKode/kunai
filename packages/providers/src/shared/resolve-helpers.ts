import { createResolveTrace, createTraceStep } from "@kunai/core";
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

  const failures = evidence.failures?.length ? evidence.failures : [providerFailure];
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
      ? {}
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
