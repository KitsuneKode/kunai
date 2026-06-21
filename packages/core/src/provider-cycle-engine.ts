import type {
  ProviderCycleAttempt,
  ProviderCycleCandidate,
  ProviderCycleFailure,
  ProviderCycleFailureClass,
  ProviderCycleIntent,
  ProviderCycleResult,
  ProviderId,
  ProviderTraceEvent,
} from "@kunai/types";

export interface ProviderCycleEngineOptions {
  readonly maxAttemptsPerCandidate?: number;
  readonly candidateTimeoutMs?: number;
  readonly retryDelayMs?: number;
}

export interface ProviderCycleCandidateContext {
  readonly signal: AbortSignal;
  readonly attempt: number;
  readonly emit: (event: ProviderTraceEvent) => void;
}

export interface RunProviderCycleInput<TResolved> extends ProviderCycleEngineOptions {
  readonly providerId: ProviderId;
  readonly candidates: readonly ProviderCycleCandidate[];
  readonly intent?: ProviderCycleIntent;
  readonly signal?: AbortSignal;
  readonly now?: () => string;
  readonly emit?: (event: ProviderTraceEvent) => void;
  readonly resolveCandidate: (
    candidate: ProviderCycleCandidate,
    context: ProviderCycleCandidateContext,
  ) => Promise<TResolved>;
  readonly shouldStopAfterFailure?: (
    failure: ProviderCycleFailure,
    candidate: ProviderCycleCandidate,
  ) => boolean;
}

const DEFAULT_MAX_ATTEMPTS_PER_CANDIDATE = 2;
const DEFAULT_CANDIDATE_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 0;

export class ProviderCycleFailureError extends Error {
  constructor(readonly failure: ProviderCycleFailure) {
    super(failure.message);
    this.name = "ProviderCycleFailureError";
  }
}

export function createProviderCycleFailureError(
  candidate: Pick<ProviderCycleCandidate, "id" | "providerId">,
  input: Omit<ProviderCycleFailure, "candidateId" | "providerId"> &
    Partial<Pick<ProviderCycleFailure, "candidateId" | "providerId">>,
): ProviderCycleFailureError {
  return new ProviderCycleFailureError({
    providerId: input.providerId ?? candidate.providerId,
    candidateId: input.candidateId ?? candidate.id,
    failureClass: input.failureClass,
    message: input.message,
    retryable: input.retryable,
    at: input.at,
  });
}

export async function runProviderCycle<TResolved>(
  input: RunProviderCycleInput<TResolved>,
): Promise<ProviderCycleResult<TResolved>> {
  const now = input.now ?? (() => new Date().toISOString());
  const events: ProviderTraceEvent[] = [];
  const attempts: ProviderCycleAttempt[] = [];

  const emit = (event: ProviderTraceEvent) => {
    events.push(event);
    input.emit?.(event);
  };

  if (input.intent === "fallback-provider") {
    return {
      attempts,
      events,
      stopReason: "fallback-requested",
      fallbackRequested: true,
      cancelled: false,
    };
  }

  if (input.intent === "cancel" || input.signal?.aborted) {
    return {
      attempts,
      events,
      stopReason: "cancelled",
      fallbackRequested: false,
      cancelled: true,
    };
  }

  const maxAttemptsPerCandidate =
    input.maxAttemptsPerCandidate ?? DEFAULT_MAX_ATTEMPTS_PER_CANDIDATE;
  const candidateTimeoutMs = input.candidateTimeoutMs ?? DEFAULT_CANDIDATE_TIMEOUT_MS;
  const retryDelayMs = input.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  for (const candidate of orderCycleCandidates(input.candidates)) {
    for (let attemptNumber = 1; attemptNumber <= maxAttemptsPerCandidate; attemptNumber++) {
      if (input.signal?.aborted) {
        return {
          attempts,
          events,
          stopReason: "cancelled",
          fallbackRequested: false,
          cancelled: true,
        };
      }

      const startedAt = now();
      emit(
        createCycleTraceEvent("source:start", candidate, startedAt, {
          attempt: attemptNumber,
        }),
      );

      try {
        const selected = await resolveCandidateWithTimeout({
          candidate,
          attempt: attemptNumber,
          candidateTimeoutMs,
          parentSignal: input.signal,
          now,
          emit,
          resolveCandidate: input.resolveCandidate,
        });
        const endedAt = now();
        attempts.push({ candidate, attempt: attemptNumber, startedAt, endedAt });
        emit(
          createCycleTraceEvent("source:success", candidate, endedAt, { attempt: attemptNumber }),
        );
        return {
          selected,
          selectedCandidate: candidate,
          attempts,
          events,
          stopReason: "resolved",
          fallbackRequested: false,
          cancelled: false,
        };
      } catch (error) {
        const failure = input.signal?.aborted
          ? createCancelledFailure(candidate, now)
          : toCycleFailure(candidate, error, now);
        const endedAt = now();
        attempts.push({ candidate, attempt: attemptNumber, startedAt, endedAt, failure });
        emit(
          createCycleTraceEvent("source:failed", candidate, endedAt, {
            attempt: attemptNumber,
            failureClass: failure.failureClass,
          }),
        );

        if (failure.failureClass === "candidate-user-cancelled") {
          return {
            attempts,
            events,
            stopReason: "cancelled",
            fallbackRequested: false,
            cancelled: true,
          };
        }

        if (failure.failureClass === "candidate-network" && !failure.retryable) {
          return {
            attempts,
            events,
            stopReason: "network-offline",
            fallbackRequested: false,
            cancelled: false,
          };
        }

        if (input.shouldStopAfterFailure?.(failure, candidate)) {
          return {
            attempts,
            events,
            stopReason: "exhausted",
            fallbackRequested: false,
            cancelled: false,
          };
        }

        if (!failure.retryable || attemptNumber >= maxAttemptsPerCandidate) {
          break;
        }

        emit(
          createCycleTraceEvent("retry:scheduled", candidate, now(), { attempt: attemptNumber }),
        );
        if (retryDelayMs > 0) {
          await sleepWithAbort(retryDelayMs, input.signal);
        }
      }
    }
  }

  return {
    attempts,
    events,
    stopReason: "exhausted",
    fallbackRequested: false,
    cancelled: false,
  };
}

function orderCycleCandidates(
  candidates: readonly ProviderCycleCandidate[],
): readonly ProviderCycleCandidate[] {
  return [...candidates].sort((left, right) => left.priority - right.priority);
}

async function resolveCandidateWithTimeout<TResolved>(input: {
  readonly candidate: ProviderCycleCandidate;
  readonly attempt: number;
  readonly candidateTimeoutMs: number;
  readonly parentSignal?: AbortSignal;
  readonly now: () => string;
  readonly emit: (event: ProviderTraceEvent) => void;
  readonly resolveCandidate: (
    candidate: ProviderCycleCandidate,
    context: ProviderCycleCandidateContext,
  ) => Promise<TResolved>;
}): Promise<TResolved> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(input.parentSignal?.reason);
  input.parentSignal?.addEventListener("abort", onParentAbort, { once: true });

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      input.resolveCandidate(input.candidate, {
        signal: controller.signal,
        attempt: input.attempt,
        emit: input.emit,
      }),
      new Promise<TResolved>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort(new Error("provider cycle candidate timeout"));
          reject(
            createProviderCycleFailureError(input.candidate, {
              failureClass: "candidate-timeout",
              message: `Provider candidate ${input.candidate.id} timed out`,
              retryable: true,
              at: input.now(),
            }),
          );
        }, input.candidateTimeoutMs);
      }),
    ]);
  } finally {
    input.parentSignal?.removeEventListener("abort", onParentAbort);
    if (timeout) clearTimeout(timeout);
  }
}

function toCycleFailure(
  candidate: ProviderCycleCandidate,
  error: unknown,
  now: () => string,
): ProviderCycleFailure {
  if (error instanceof ProviderCycleFailureError) {
    return error.failure;
  }

  if (isAbortError(error)) {
    return {
      providerId: candidate.providerId,
      candidateId: candidate.id,
      failureClass: "candidate-user-cancelled",
      message: "Provider cycle cancelled",
      retryable: false,
      at: now(),
    };
  }

  const classified = classifyProviderCycleError(error);
  return {
    providerId: candidate.providerId,
    candidateId: candidate.id,
    failureClass: classified.failureClass,
    message: classified.message,
    retryable: classified.retryable,
    at: now(),
  };
}

function createCancelledFailure(
  candidate: ProviderCycleCandidate,
  now: () => string,
): ProviderCycleFailure {
  return {
    providerId: candidate.providerId,
    candidateId: candidate.id,
    failureClass: "candidate-user-cancelled",
    message: "Provider cycle cancelled",
    retryable: false,
    at: now(),
  };
}

export function classifyProviderCycleError(error: unknown): {
  readonly failureClass: ProviderCycleFailureClass;
  readonly message: string;
  readonly retryable: boolean;
} {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (isAbortError(error)) {
    return {
      failureClass: "candidate-user-cancelled",
      message: "Provider cycle cancelled",
      retryable: false,
    };
  }
  if (isNetworkOfflineMessage(message)) {
    return {
      failureClass: "candidate-network",
      message: error instanceof Error ? error.message : String(error),
      retryable: false,
    };
  }
  if (message.includes("network") || message.includes("fetch")) {
    return {
      failureClass: "candidate-network",
      message: error instanceof Error ? error.message : String(error),
      retryable: true,
    };
  }
  if (message.includes("expired")) {
    return {
      failureClass: "candidate-expired",
      message: error instanceof Error ? error.message : String(error),
      retryable: true,
    };
  }
  if (message.includes("blocked") || message.includes("403")) {
    return {
      failureClass: "candidate-blocked",
      message: error instanceof Error ? error.message : String(error),
      retryable: false,
    };
  }
  if (message.includes("parse")) {
    return {
      failureClass: "candidate-parse",
      message: error instanceof Error ? error.message : String(error),
      retryable: false,
    };
  }
  return {
    failureClass: "candidate-unknown",
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
  };
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError")
  );
}

function isNetworkOfflineMessage(message: string): boolean {
  return (
    message.includes("enotfound") ||
    message.includes("eai_again") ||
    message.includes("network is unreachable") ||
    message.includes("network unreachable") ||
    message.includes("internet disconnected") ||
    message.includes("offline") ||
    message.includes("failed to resolve") ||
    message.includes("could not resolve host")
  );
}

function createCycleTraceEvent(
  type: ProviderTraceEvent["type"],
  candidate: ProviderCycleCandidate,
  at: string,
  attributes: Record<string, string | number | boolean | null> = {},
): ProviderTraceEvent {
  return {
    type,
    at,
    providerId: candidate.providerId,
    sourceId: candidate.sourceId,
    variantId: candidate.variantId,
    streamId: candidate.streamId,
    attempt: typeof attributes.attempt === "number" ? attributes.attempt : undefined,
    message: candidate.label ?? candidate.id,
    attributes: {
      candidateId: candidate.id,
      serverId: candidate.serverId ?? null,
      groupId: candidate.groupId ?? null,
      nativeLabel: candidate.nativeLabel ?? null,
      ...attributes,
    },
  };
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
