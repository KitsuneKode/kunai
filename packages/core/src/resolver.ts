import type { ProviderFailure, ProviderId, ProviderResolveResult } from "@kunai/types";

export interface ResolveCandidate<TStream> {
  readonly providerId: ProviderId;
  readonly preferred?: boolean;
  resolve(): Promise<TStream | null>;
}

export interface ResolveAttempt<TStream> {
  readonly providerId: ProviderId;
  readonly stream: TStream | null;
  readonly result?: ProviderResolveResult;
  readonly failure?: ProviderFailure;
}

export interface ResolveWithFallbackResult<TStream> {
  readonly stream: TStream | null;
  readonly providerId?: ProviderId;
  readonly result?: ProviderResolveResult;
  readonly attempts: readonly ResolveAttempt<TStream>[];
}

export class ProviderResolveFailureError extends Error {
  constructor(readonly failure: ProviderFailure) {
    super(failure.message);
    this.name = "ProviderResolveFailureError";
  }
}

export function createProviderResolveFailureError(
  result: ProviderResolveResult,
  message = "Provider returned no playable stream candidates",
): ProviderResolveFailureError {
  return new ProviderResolveFailureError(
    result.failures[0] ?? {
      providerId: result.providerId,
      code: "not-found",
      message,
      retryable: true,
      at: new Date().toISOString(),
    },
  );
}

export async function resolveWithFallback<
  TStream extends { providerResolveResult?: ProviderResolveResult },
>({
  candidates,
  signal,
  now = () => new Date().toISOString(),
}: {
  readonly candidates: readonly ResolveCandidate<TStream>[];
  readonly signal?: AbortSignal;
  readonly now?: () => string;
}): Promise<ResolveWithFallbackResult<TStream>> {
  const ordered = orderCandidates(candidates);
  const attempts: ResolveAttempt<TStream>[] = [];

  for (const candidate of ordered) {
    if (signal?.aborted) break;
    try {
      const stream = await candidate.resolve();
      const attempt: ResolveAttempt<TStream> = {
        providerId: candidate.providerId,
        stream,
        result: stream?.providerResolveResult,
      };
      attempts.push(attempt);

      if (stream) {
        return {
          stream,
          providerId: candidate.providerId,
          result: stream.providerResolveResult,
          attempts,
        };
      }
    } catch (error) {
      if (signal?.aborted) break;
      attempts.push({
        providerId: candidate.providerId,
        stream: null,
        failure:
          error instanceof ProviderResolveFailureError
            ? error.failure
            : {
                providerId: candidate.providerId,
                code: "unknown",
                message: error instanceof Error ? error.message : String(error),
                retryable: true,
                at: now(),
              },
      });
    }
  }

  return {
    stream: null,
    attempts,
  };
}

function orderCandidates<TStream>(
  candidates: readonly ResolveCandidate<TStream>[],
): readonly ResolveCandidate<TStream>[] {
  return [...candidates].sort(
    (a, b) => Number(Boolean(b.preferred)) - Number(Boolean(a.preferred)),
  );
}
