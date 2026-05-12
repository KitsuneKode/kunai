import {
  createResolveTrace,
  createTraceStep,
} from "@kunai/core";
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
  const cachePolicy =
    evidence.cachePolicy ??
    {
      ttlClass: "stream-manifest" as const,
      scope: "local" as const,
      keyParts: [providerId, "exhausted"],
    };

  return {
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
    healthDelta: {
      providerId,
      outcome: "failure",
      at,
    },
  };
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
