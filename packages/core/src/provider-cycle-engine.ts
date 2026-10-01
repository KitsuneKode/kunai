import type {
  EndpointFailureClass,
  EndpointHealthPort,
  ProviderCycleAttempt,
  ProviderCycleCandidate,
  ProviderCycleFailure,
  ProviderCycleFailureClass,
  ProviderCycleIntent,
  ProviderCycleResult,
  ProviderId,
  ProviderTraceEvent,
} from "@kunai/types";
import { httpStatusIsRetryable, ProviderHttpError } from "@kunai/types";
import type { ResolveErrorCode } from "@kunai/types";

import { guardEndpointHealthAgainstCancellation } from "./provider-attempt-cancellation";
import { isOfflineNetworkFailure } from "./provider-failure-classifier";

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
  readonly endpointHealth?: EndpointHealthPort;
  readonly titleId?: string;
  readonly allowTransientCandidateRetry?: boolean;
  /**
   * When > 0, start the next candidate alongside the current one after this
   * delay and take whichever resolves first. Absent or <= 0 keeps the strictly
   * sequential walk.
   *
   * Off by default: racing multiplies outbound requests to the sites being
   * scraped, so enabling it is a measured decision per provider, not a global
   * default. Raced candidates get a single attempt each — racing buys breadth
   * instead of the sequential path's depth, so `maxAttemptsPerCandidate` and
   * `allowTransientCandidateRetry` do not apply while racing.
   */
  readonly hedgeDelayMs?: number;
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
/**
 * Re-firing a candidate the instant it timed out just reproduces the timeout —
 * the endpoint has had no time to recover. Callers that say nothing about retry
 * delay get this for transient failures; an explicit `retryDelayMs` still wins,
 * so tests and tuned providers keep full control.
 */
const DEFAULT_TRANSIENT_RETRY_DELAY_MS = 750;

/**
 * Distinct servers that must produce offline-classified failures before a
 * cycle calls the uplink dead. One source's ENOTFOUND can be that domain's
 * own death; two different servers failing the same way is real evidence.
 * Mirrors the provider-level `OfflineEvidenceTracker` threshold.
 */
const OFFLINE_EVIDENCE_QUORUM = 2;

export class ProviderCycleFailureError extends Error {
  constructor(readonly failure: ProviderCycleFailure) {
    super(failure.message);
    this.name = "ProviderCycleFailureError";
  }
}

export function createProviderCycleFailureError(
  candidate: Pick<ProviderCycleCandidate, "id" | "providerId">,
  input: Omit<ProviderCycleFailure, "candidateId" | "providerId"> &
    Partial<Pick<ProviderCycleFailure, "candidateId" | "providerId">> &
    Record<string, unknown>,
): ProviderCycleFailureError {
  const { providerId, candidateId, failureClass, message, retryable, at, ...extra } = input;
  const failure = {
    failureClass,
    message,
    retryable,
    at,
    providerId: providerId ?? candidate.providerId,
    candidateId: candidateId ?? candidate.id,
  } as ProviderCycleFailure;
  // Forward-compatible: fields added to the failure contract later (e.g. an
  // endpoint-scoped quarantine signal) survive the builder instead of being
  // silently dropped here while the type moves on.
  Object.assign(failure, extra);
  return new ProviderCycleFailureError(failure);
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
  const retryDelayMs = input.retryDelayMs;
  // An extra attempt *on top of* the normal budget. Carving it out of the
  // budget instead made the flag inert at every call site.
  const transientRetryBudget = input.allowTransientCandidateRetry === true ? 1 : 0;

  const hedgeDelayMs = Math.max(0, input.hedgeDelayMs ?? 0);
  if (hedgeDelayMs > 0) {
    return runProviderCycleRaced({
      input,
      hedgeDelayMs,
      candidateTimeoutMs,
      now,
      emit,
      events,
      attempts,
    });
  }

  let skippedQuarantined = 0;
  let attemptedCandidates = 0;
  // Offline evidence is corroborated across distinct servers before the walk
  // abandons the pool: one source's DNS failure can be a dead upstream domain,
  // not a dead uplink — miruro-style multi-mirror providers would otherwise
  // skip every remaining mirror on the first one's ENOTFOUND.
  const offlineEvidenceServers = new Set<string>();

  for (const candidate of orderCycleCandidates(input.candidates)) {
    const endpoint = candidate.serverId;
    if (
      endpoint &&
      input.endpointHealth &&
      !input.endpointHealth.shouldTry(input.providerId, endpoint)
    ) {
      skippedQuarantined += 1;
      emit(
        createCycleTraceEvent("source:skipped", candidate, now(), {
          reason: "quarantined",
          endpoint,
        }),
      );
      continue;
    }

    attemptedCandidates += 1;

    let transientRetriesUsed = 0;
    for (
      let attemptNumber = 1;
      attemptNumber <= maxAttemptsPerCandidate + transientRetryBudget;
      attemptNumber++
    ) {
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
        if (endpoint && input.endpointHealth) {
          input.endpointHealth.recordSuccess(input.providerId, endpoint);
        }
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

        if (endpoint && input.endpointHealth) {
          const endpointFailureClass = classifyEndpointFailureFromCycleFailure(failure);
          if (endpointFailureClass) {
            input.endpointHealth.recordFailure(input.providerId, endpoint, {
              class: endpointFailureClass,
              titleId: input.titleId,
              at: failure.at,
            });
          }
        }

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
          offlineEvidenceServers.add(candidate.serverId ?? candidate.id);
          if (offlineEvidenceServers.size >= OFFLINE_EVIDENCE_QUORUM) {
            return {
              attempts,
              events,
              stopReason: "network-offline",
              fallbackRequested: false,
              cancelled: false,
            };
          }
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

        if (!failure.retryable || attemptNumber >= maxAttemptsPerCandidate + transientRetriesUsed) {
          if (
            failure.retryable &&
            transientRetriesUsed < transientRetryBudget &&
            (failure.failureClass === "candidate-timeout" ||
              failure.failureClass === "candidate-network")
          ) {
            transientRetriesUsed += 1;
            emit(
              createCycleTraceEvent("retry:scheduled", candidate, now(), {
                attempt: attemptNumber,
                reason: "transient-endpoint",
              }),
            );
            const transientDelayMs = retryDelayForFailureClass(retryDelayMs, failure.failureClass);
            if (transientDelayMs > 0) {
              await sleepWithAbort(transientDelayMs, input.signal);
            }
            continue;
          }
          break;
        }

        emit(
          createCycleTraceEvent("retry:scheduled", candidate, now(), { attempt: attemptNumber }),
        );
        const nextDelayMs = retryDelayForFailureClass(retryDelayMs, failure.failureClass);
        if (nextDelayMs > 0) {
          await sleepWithAbort(nextDelayMs, input.signal);
        }
      }
    }
  }

  if (attemptedCandidates === 0 && skippedQuarantined > 0) {
    return {
      attempts,
      events,
      stopReason: "all-quarantined",
      fallbackRequested: false,
      cancelled: false,
    };
  }

  return {
    attempts,
    events,
    stopReason: "exhausted",
    fallbackRequested: false,
    cancelled: false,
  };
}

/**
 * Race a provider's own source candidates.
 *
 * Mirrors `ProviderEngine.resolveHedged` one layer down: the next candidate
 * launches after `hedgeDelayMs` while the current one is still in flight, the
 * first success wins, and the losers are aborted immediately.
 *
 * Each candidate gets its own `AbortController`, and its endpoint-health writes
 * go through `guardEndpointHealthAgainstCancellation` so a loser's abort cannot
 * be recorded as a failure. Without that guard this would steadily quarantine
 * the slower half of a perfectly healthy candidate pool, invisibly.
 *
 * Failures are classified exactly as the sequential path classifies them, so a
 * provider-wide session guard stays unattributed to the endpoint that happened
 * to surface it.
 *
 * Each raced candidate is attempted once. Retrying inside a race would compete
 * with the candidates already in flight for the same win.
 */
async function runProviderCycleRaced<TResolved>(args: {
  readonly input: RunProviderCycleInput<TResolved>;
  readonly hedgeDelayMs: number;
  readonly candidateTimeoutMs: number;
  readonly now: () => string;
  readonly emit: (event: ProviderTraceEvent) => void;
  readonly events: ProviderTraceEvent[];
  readonly attempts: ProviderCycleAttempt[];
}): Promise<ProviderCycleResult<TResolved>> {
  const { input, now, emit, events, attempts } = args;

  type Settled =
    | { readonly kind: "success"; readonly index: number; readonly selected: TResolved }
    | { readonly kind: "failure"; readonly index: number; readonly error: unknown };

  interface InFlight {
    readonly candidate: ProviderCycleCandidate;
    readonly controller: AbortController;
    readonly settled: Promise<Settled>;
    readonly startedAt: string;
  }

  let skippedQuarantined = 0;
  const offlineEvidenceServers = new Set<string>();
  const eligible = orderCycleCandidates(input.candidates).filter((candidate) => {
    const endpoint = candidate.serverId;
    if (!endpoint || !input.endpointHealth) return true;
    if (input.endpointHealth.shouldTry(input.providerId, endpoint)) return true;
    skippedQuarantined += 1;
    emit(
      createCycleTraceEvent("source:skipped", candidate, now(), {
        reason: "quarantined",
        endpoint,
      }),
    );
    return false;
  });

  const inFlight = new Map<number, InFlight>();
  let nextIndex = 0;

  const abortAll = (reason?: unknown) => {
    for (const entry of inFlight.values()) entry.controller.abort(reason);
    inFlight.clear();
  };

  const launchNext = (): boolean => {
    const candidate = eligible[nextIndex];
    if (!candidate) return false;

    const index = nextIndex++;
    const controller = new AbortController();
    const startedAt = now();
    emit(createCycleTraceEvent("source:start", candidate, startedAt, { attempt: 1 }));

    const endpoint = candidate.serverId;
    const health = input.endpointHealth
      ? guardEndpointHealthAgainstCancellation(input.endpointHealth, controller.signal)
      : undefined;

    const settled: Promise<Settled> = resolveCandidateWithTimeout({
      candidate,
      attempt: 1,
      candidateTimeoutMs: args.candidateTimeoutMs,
      parentSignal: controller.signal,
      now,
      emit,
      resolveCandidate: input.resolveCandidate,
    }).then(
      (selected): Settled => {
        if (endpoint && health) health.recordSuccess(input.providerId, endpoint);
        return { kind: "success", index, selected };
      },
      (error): Settled => {
        if (endpoint && health) {
          const failureClass = classifyEndpointFailureFromCycleFailure(
            toCycleFailure(candidate, error, now),
          );
          if (failureClass) {
            health.recordFailure(input.providerId, endpoint, {
              class: failureClass,
              titleId: input.titleId,
              at: now(),
            });
          }
        }
        return { kind: "failure", index, error };
      },
    );

    inFlight.set(index, { candidate, controller, settled, startedAt });
    return true;
  };

  const onParentAbort = () => abortAll(input.signal?.reason);
  input.signal?.addEventListener("abort", onParentAbort, { once: true });

  try {
    launchNext();

    while (inFlight.size > 0) {
      if (input.signal?.aborted) break;

      let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
      const racers: Array<Promise<Settled | "hedge">> = [...inFlight.values()].map(
        (entry) => entry.settled,
      );
      if (nextIndex < eligible.length) {
        racers.push(
          new Promise<"hedge">((resolve) => {
            hedgeTimer = setTimeout(() => resolve("hedge"), args.hedgeDelayMs);
          }),
        );
      }

      const outcome = await Promise.race(racers);
      if (hedgeTimer) clearTimeout(hedgeTimer);

      if (outcome === "hedge") {
        launchNext();
        continue;
      }

      const entry = inFlight.get(outcome.index);
      inFlight.delete(outcome.index);
      if (!entry) continue;

      const endedAt = now();

      if (outcome.kind === "success") {
        attempts.push({
          candidate: entry.candidate,
          attempt: 1,
          startedAt: entry.startedAt,
          endedAt,
        });
        emit(createCycleTraceEvent("source:success", entry.candidate, endedAt, { attempt: 1 }));
        abortAll();
        return {
          selected: outcome.selected,
          selectedCandidate: entry.candidate,
          attempts,
          events,
          stopReason: "resolved",
          fallbackRequested: false,
          cancelled: false,
        };
      }

      const failure = input.signal?.aborted
        ? createCancelledFailure(entry.candidate, now)
        : toCycleFailure(entry.candidate, outcome.error, now);
      attempts.push({
        candidate: entry.candidate,
        attempt: 1,
        startedAt: entry.startedAt,
        endedAt,
        failure,
      });
      emit(
        createCycleTraceEvent("source:failed", entry.candidate, endedAt, {
          attempt: 1,
          failureClass: failure.failureClass,
        }),
      );

      if (failure.failureClass === "candidate-user-cancelled") {
        abortAll();
        return {
          attempts,
          events,
          stopReason: "cancelled",
          fallbackRequested: false,
          cancelled: true,
        };
      }

      if (failure.failureClass === "candidate-network" && !failure.retryable) {
        offlineEvidenceServers.add(entry.candidate.serverId ?? entry.candidate.id);
        if (offlineEvidenceServers.size >= OFFLINE_EVIDENCE_QUORUM) {
          abortAll();
          return {
            attempts,
            events,
            stopReason: "network-offline",
            fallbackRequested: false,
            cancelled: false,
          };
        }
      }

      // A provider-wide guard is not answered by hammering the rest of the
      // pool, so it ends the race exactly as it ends the sequential walk.
      if (input.shouldStopAfterFailure?.(failure, entry.candidate)) {
        abortAll();
        return {
          attempts,
          events,
          stopReason: "exhausted",
          fallbackRequested: false,
          cancelled: false,
        };
      }

      if (inFlight.size === 0) launchNext();
    }

    if (input.signal?.aborted) {
      return {
        attempts,
        events,
        stopReason: "cancelled",
        fallbackRequested: false,
        cancelled: true,
      };
    }

    if (eligible.length === 0 && skippedQuarantined > 0) {
      return {
        attempts,
        events,
        stopReason: "all-quarantined",
        fallbackRequested: false,
        cancelled: false,
      };
    }

    return {
      attempts,
      events,
      stopReason: "exhausted",
      fallbackRequested: false,
      cancelled: false,
    };
  } finally {
    input.signal?.removeEventListener("abort", onParentAbort);
    abortAll();
  }
}

function retryDelayForFailureClass(
  explicitDelayMs: number | undefined,
  failureClass: ProviderCycleFailureClass,
): number {
  if (explicitDelayMs !== undefined) return explicitDelayMs;
  if (failureClass === "candidate-timeout" || failureClass === "candidate-network") {
    return DEFAULT_TRANSIENT_RETRY_DELAY_MS;
  }
  return DEFAULT_RETRY_DELAY_MS;
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

export function classifyEndpointFailureFromCycleFailure(
  failure: ProviderCycleFailure,
): EndpointFailureClass | null {
  switch (failure.failureClass) {
    case "candidate-timeout":
    case "candidate-network":
      return "transient";
    case "candidate-parse":
      // A malformed response is endpoint evidence. ProviderEndpointHealthService
      // still applies its distinct-title guard before escalating it.
      return "server-error";
    case "candidate-server-error":
      // A 5xx IS the endpoint answering badly — server-error so the
      // distinct-title quarantine gate can see it (#458).
      return "server-error";
    case "candidate-rate-limited":
      // A 429 that survives across distinct titles is an endpoint that cannot
      // serve this session; quarantining it is what stops the provider being
      // re-probed forever. Same gate, same downstream title guard.
      return "server-error";
    case "candidate-blocked":
      // "Blocked" is not endpoint-scoped evidence on its own. It includes
      // provider-wide session guards, regional WAF/Cloudflare responses, and
      // endpoint-local 403s. Persisting all of those as a server error can
      // quarantine a healthy mirror after two titles merely because the user
      // has no valid provider session.
      //
      // `endpointScoped` is the explicit reason this waited for: a resolve-gate
      // rejection is a segment probe against this endpoint's own stream, so a
      // definitive refusal there is durable evidence about that server alone.
      // `server-error` rather than `route-dead` because the shorter quarantine
      // still carries ProviderEndpointHealthService's distinct-title guard, and
      // a CDN that rotates hosts should not be written off for a day.
      return failure.endpointScoped === true ? "server-error" : null;
    default:
      return null;
  }
}

export type ProviderCycleErrorClassification = {
  readonly failureClass: ProviderCycleFailureClass;
  readonly message: string;
  readonly retryable: boolean;
};

export function classifyProviderCycleError(error: unknown): ProviderCycleErrorClassification {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (isAbortError(error)) {
    return {
      failureClass: "candidate-user-cancelled",
      message: "Provider cycle cancelled",
      retryable: false,
    };
  }
  /* `AbortSignal.timeout` raises a DOMException named "TimeoutError", which is
   * not an AbortError — without this case a per-request deadline reads as a
   * generic retryable blip instead of the timeout it is. */
  if (error instanceof Error && error.name === "TimeoutError") {
    return {
      failureClass: "candidate-timeout",
      message: error.message,
      retryable: true,
    };
  }
  /* A provider that threw with its HTTP status attached gets classified on
   * that status, not on whatever the message happens to contain — otherwise a
   * 429 or 503 reads as a generic retryable blip and never reaches the
   * quarantine gate (#458). */
  if (error instanceof ProviderHttpError) {
    return {
      failureClass: providerHttpCycleFailureClass(error),
      message: error.message,
      retryable: error.retryable,
    };
  }
  if (isNetworkOfflineMessage(message)) {
    return {
      failureClass: "candidate-network",
      message: error instanceof Error ? error.message : String(error),
      retryable: false,
    };
  }
  /* A thrown value that carries the typed fields without being a
   * ProviderHttpError instance — a provider error class that predates the
   * base type, or an error reconstituted across a serialization boundary —
   * still classifies on structure instead of prose (#458). An errno-style
   * `code` like "ENOTFOUND" does not enter: the field must name a real
   * ResolveErrorCode, carry an HTTP status, or name a transportKind. */
  const structured = structuredErrorEvidence(error);
  if (structured) {
    return {
      failureClass: providerCycleFailureClassFromParts(structured),
      message: error instanceof Error ? error.message : String(error),
      retryable:
        structured.retryable ??
        (structured.status !== undefined
          ? httpStatusIsRetryable(structured.status)
          : structured.transportKind !== "offline"),
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

function providerHttpCycleFailureClass(error: ProviderHttpError): ProviderCycleFailureClass {
  return providerCycleFailureClassFromParts(error);
}

/**
 * The parts-shaped classifier: every structured error this layer recognizes
 * carries a subset of `{code, status, transportKind}`, and each vocabulary
 * slot answers a different failure class. `transportKind` is the transport
 * taxonomy's word for "timeout" — folded in beside the ResolveErrorCode so a
 * reconstituted ProviderTransportError classifies the same as the live one.
 */
function providerCycleFailureClassFromParts(parts: {
  readonly code?: ResolveErrorCode;
  readonly status?: number;
  readonly transportKind?: string;
}): ProviderCycleFailureClass {
  const { code, status, transportKind } = parts;
  if (code === "rate-limited" || status === 429) return "candidate-rate-limited";
  if (code === "provider-unavailable" || (status !== undefined && status >= 500)) {
    return "candidate-server-error";
  }
  if (code === "blocked" || status === 401 || status === 403) return "candidate-blocked";
  if (code === "timeout" || transportKind === "timeout" || status === 408 || status === 504) {
    return "candidate-timeout";
  }
  if (code === "not-found" || status === 404) return "candidate-empty";
  if (code === "parse-failed") return "candidate-parse";
  if (code === "expired") return "candidate-expired";
  if (code === "unsupported-title") return "candidate-unsupported";
  if (code === "cancelled") return "candidate-user-cancelled";
  return "candidate-network";
}

/** ResolveErrorCode as a runtime set — `new Set<…>` so a mistyped member is a
 * compile error at declaration, while `.has` still takes an arbitrary string. */
const RESOLVE_ERROR_CODES: ReadonlySet<string> = new Set<ResolveErrorCode>([
  "provider-unavailable",
  "unsupported-title",
  "not-found",
  "network-error",
  "rate-limited",
  "blocked",
  "expired",
  "parse-failed",
  "runtime-missing",
  "yt-dlp-missing",
  "timeout",
  "cancelled",
  "missing-input",
  "unknown",
]);

/**
 * Read the typed fields off a thrown value without trusting its prototype.
 * Returns null unless at least one vocabulary slot is real evidence — a
 * Node errno (`code: "ECONNRESET"`) is not a ResolveErrorCode and must keep
 * falling through to message classification.
 */
function structuredErrorEvidence(error: unknown): {
  readonly code?: ResolveErrorCode;
  readonly status?: number;
  readonly retryable?: boolean;
  readonly transportKind?: string;
} | null {
  if (typeof error !== "object" || error === null) return null;
  const record = error as Record<string, unknown>;
  const code =
    typeof record.code === "string" && RESOLVE_ERROR_CODES.has(record.code)
      ? (record.code as ResolveErrorCode)
      : undefined;
  const status =
    typeof record.status === "number" && record.status >= 100 && record.status <= 599
      ? record.status
      : undefined;
  const transportKind = typeof record.transportKind === "string" ? record.transportKind : undefined;
  const retryable = typeof record.retryable === "boolean" ? record.retryable : undefined;
  if (!code && status === undefined && !transportKind) return null;
  return { code, status, retryable, transportKind };
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
  return isOfflineNetworkFailure({
    code: "network-error",
    message,
  });
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
