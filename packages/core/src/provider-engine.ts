import type {
  EndpointHealthPort,
  ProviderFailure,
  ProviderId,
  ProviderAuthPort,
  ProviderFetchPort,
  ProviderResolveInput,
  ProviderResolveResult,
  ProviderRuntimeContext,
  ProviderTitleBridgePort,
  ProviderTraceEvent,
} from "@kunai/types";
import { isProviderResolveResultResolved } from "@kunai/types";

import { DEFAULT_CONSECUTIVE_OFFLINE_THRESHOLD, OfflineEvidenceTracker } from "./offline-evidence";
import {
  guardEndpointHealthAgainstCancellation,
  ProviderAttemptTimeoutError,
} from "./provider-attempt-cancellation";
import { isOfflineNetworkFailure } from "./provider-failure-classifier";
import { resolveProviderIdAlias } from "./provider-id-aliases";
import type { CoreProviderModule } from "./provider-sdk";
import { createProviderRuntimeContext } from "./provider-sdk";
import {
  createProviderResolveFailureError,
  ProviderResolveAbortError,
  ProviderResolveFailureError,
} from "./resolver";

export function resolveProviderId(providerId: ProviderId): ProviderId {
  return resolveProviderIdAlias(providerId);
}

export interface ProviderEngineOptions {
  readonly modules: readonly CoreProviderModule[];
  readonly maxAttempts?: number;
  readonly attemptTimeoutMs?: number;
  readonly retryDelayMs?: number;
  readonly now?: () => string;
  readonly auth?: ProviderAuthPort;
  readonly fetch?: ProviderFetchPort | ProviderFetchPortFactory;
  readonly endpointHealth?: EndpointHealthPort;
  readonly titleBridge?: ProviderTitleBridgePort;
  /**
   * How many consecutive providers must fail with reliable offline-evidence
   * before the engine abandons all remaining candidates.  On a glitchy network
   * a single DNS flake from one provider should not kill every fallback; a
   * cluster of them across different providers is a genuine offline signal.
   * Default 2.
   */
  readonly consecutiveOfflineThreshold?: number;
  /**
   * Start the next candidate this long after the current one begins, rather
   * than waiting for it to fully exhaust. Sequential fallback spends the whole
   * resolve budget on one slow provider; hedging overlaps them and takes the
   * first success.
   *
   * 0 (the default) keeps fallback strictly sequential — which also keeps the
   * user's provider priority authoritative, since with hedging the fastest
   * responder wins rather than the highest-ranked one.
   */
  readonly hedgeDelayMs?: number;
  /** Providers allowed to resolve concurrently while hedging. Default 2. */
  readonly maxConcurrentCandidates?: number;
}

export type ProviderFetchPortFactory = (providerId: ProviderId) => ProviderFetchPort | undefined;

export interface ProviderEngineResolveAttempt {
  readonly providerId: ProviderId;
  readonly result?: ProviderResolveResult;
  readonly failure?: ProviderFailure;
}

export interface ProviderEngineResolveOutput {
  readonly result: ProviderResolveResult | null;
  readonly providerId: ProviderId | null;
  readonly attempts: readonly ProviderEngineResolveAttempt[];
}

export type ProviderEngineEvent =
  | {
      readonly type: "provider-attempt-started";
      readonly providerId: ProviderId;
      readonly attempt: number;
      readonly at: string;
    }
  | {
      readonly type: "provider-attempt-succeeded";
      readonly providerId: ProviderId;
      readonly attempt: number;
      readonly at: string;
      readonly elapsedMs: number;
    }
  | {
      readonly type: "provider-attempt-failed";
      readonly providerId: ProviderId;
      readonly attempt: number;
      readonly at: string;
      readonly elapsedMs: number;
      readonly failure: ProviderFailure;
    }
  | {
      readonly type: "provider-retry-scheduled";
      readonly providerId: ProviderId;
      readonly nextAttempt: number;
      readonly at: string;
      readonly delayMs: number;
    }
  | {
      readonly type: "provider-fallback-started";
      readonly fromProviderId: ProviderId;
      readonly toProviderId: ProviderId;
      readonly at: string;
      readonly failure: ProviderFailure;
    }
  | {
      /**
       * A candidate was started *alongside* a still-running one rather than
       * after it failed. Distinct from fallback so traces do not imply the
       * previous provider was finished.
       */
      readonly type: "provider-hedge-started";
      readonly fromProviderId: ProviderId;
      readonly toProviderId: ProviderId;
      readonly at: string;
      readonly hedgeDelayMs: number;
    }
  | {
      /**
       * Fallback stopped with candidates still untried. Without this, an
       * offline break looks identical to "no candidates remained" in traces.
       */
      readonly type: "provider-fallback-halted";
      readonly fromProviderId: ProviderId;
      readonly skippedProviderIds: readonly ProviderId[];
      readonly reason: "offline";
      readonly at: string;
      readonly failure: ProviderFailure;
    };

export type ProviderEngineObserver = (event: ProviderEngineEvent) => void;

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 250;
/**
 * Offline evidence from a single provider is weak, but retrying a genuinely
 * unreachable host is wasted time when fallback candidates remain. One extra
 * attempt covers a transient resolver blip (EAI_AGAIN) without burning the
 * full attempt budget on a dead domain.
 */
const OFFLINE_EVIDENCE_MAX_ATTEMPTS = 2;
const DEFAULT_HEDGE_DELAY_MS = 0;
const DEFAULT_MAX_CONCURRENT_CANDIDATES = 2;

export class ProviderEngine {
  private readonly modulesById = new Map<ProviderId, CoreProviderModule>();
  readonly modules: readonly CoreProviderModule[];
  private readonly maxAttempts: number;
  private readonly attemptTimeoutMs: number;
  private readonly retryDelayMs: number;
  private readonly now: () => string;
  private readonly auth?: ProviderAuthPort;
  private readonly fetch?: ProviderFetchPort | ProviderFetchPortFactory;
  private readonly endpointHealth?: EndpointHealthPort;
  private readonly titleBridge?: ProviderTitleBridgePort;
  private readonly consecutiveOfflineThreshold: number;
  private readonly hedgeDelayMs: number;
  private readonly maxConcurrentCandidates: number;

  constructor(opts: ProviderEngineOptions) {
    this.modules = opts.modules;
    this.maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.attemptTimeoutMs = opts.attemptTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.consecutiveOfflineThreshold =
      opts.consecutiveOfflineThreshold ?? DEFAULT_CONSECUTIVE_OFFLINE_THRESHOLD;
    this.hedgeDelayMs = Math.max(0, opts.hedgeDelayMs ?? DEFAULT_HEDGE_DELAY_MS);
    this.maxConcurrentCandidates = Math.max(
      1,
      opts.maxConcurrentCandidates ?? DEFAULT_MAX_CONCURRENT_CANDIDATES,
    );
    this.now = opts.now ?? (() => new Date().toISOString());
    this.auth = opts.auth;
    this.fetch = opts.fetch;
    this.endpointHealth = opts.endpointHealth;
    this.titleBridge = opts.titleBridge;

    for (const module of opts.modules) {
      if (this.modulesById.has(module.providerId)) {
        throw new Error(`Duplicate provider module id: ${module.providerId}`);
      }
      this.modulesById.set(module.providerId, module);
    }
  }

  get(providerId: ProviderId): CoreProviderModule | undefined {
    return this.modulesById.get(resolveProviderId(providerId));
  }

  getManifest(providerId: ProviderId) {
    return this.modulesById.get(resolveProviderId(providerId))?.manifest;
  }

  getProviderIds(): ProviderId[] {
    return [...this.modulesById.keys()];
  }

  createRuntimeContext(providerId: ProviderId, signal?: AbortSignal): ProviderRuntimeContext {
    return createProviderRuntimeContext({
      now: this.now,
      providerId,
      signal,
      retryPolicy: {
        maxAttempts: this.maxAttempts,
        backoff: "none",
        delayMs: this.retryDelayMs,
      },
      fetch: resolveFetchPort(this.fetch, providerId),
      auth: this.auth,
      // Same rule as the attempt path: a cancelled caller must not leave
      // failure evidence against an endpoint that was merely interrupted.
      endpointHealth: this.endpointHealth
        ? guardEndpointHealthAgainstCancellation(this.endpointHealth, signal)
        : undefined,
      titleBridge: this.titleBridge,
    });
  }

  async resolve(
    input: ProviderResolveInput,
    providerId: ProviderId,
    signal?: AbortSignal,
    observer?: ProviderEngineObserver,
  ): Promise<ProviderResolveResult> {
    const resolvedProviderId = resolveProviderId(providerId);
    const module = this.modulesById.get(resolvedProviderId);
    if (!module) {
      throw new Error(`Provider module not found: ${providerId}`);
    }
    if (!module.manifest.mediaKinds.includes(input.mediaKind)) {
      throw new ProviderResolveFailureError({
        providerId,
        code: "unsupported-title",
        message: `Provider ${providerId} does not support ${input.mediaKind} media`,
        retryable: false,
        at: this.now(),
      });
    }

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      if (signal?.aborted) throw this.abortError();

      const startedAt = this.now();
      observer?.({ type: "provider-attempt-started", providerId, attempt, at: startedAt });

      let failure: ProviderFailure | null = null;
      let failureError: ProviderResolveFailureError | null = null;
      try {
        const result = await this.resolveWithTimeout(module, input, startedAt, signal);
        const finishedAt = this.now();

        if (result && isProviderResolveResultResolved(result)) {
          observer?.({
            type: "provider-attempt-succeeded",
            providerId,
            attempt,
            at: finishedAt,
            elapsedMs: elapsedMs(startedAt, finishedAt),
          });
          return result;
        }

        failureError = result ? createProviderResolveFailureError(result) : null;
        failure = failureError
          ? failureError.failure
          : {
              providerId,
              code: "not-found",
              message: `Provider ${providerId} did not return a stream`,
              retryable: true,
              at: finishedAt,
            };
        observer?.({
          type: "provider-attempt-failed",
          providerId,
          attempt,
          at: finishedAt,
          elapsedMs: elapsedMs(startedAt, finishedAt),
          failure,
        });
      } catch (error) {
        if (error instanceof ProviderResolveAbortError) throw error;
        const finishedAt = this.now();
        failure = failureFromResolveError(error, providerId, finishedAt);
        failureError = error instanceof ProviderResolveFailureError ? error : null;
        observer?.({
          type: "provider-attempt-failed",
          providerId,
          attempt,
          at: finishedAt,
          elapsedMs: elapsedMs(startedAt, finishedAt),
          failure,
        });
      }

      if (signal?.aborted) throw this.abortError();

      // Offline evidence caps this provider's budget early, but does not skip
      // retries entirely — a lone resolver blip deserves one more attempt.
      const offlineBudgetSpent =
        isOfflineNetworkFailure(failure) &&
        attempt >= Math.min(this.maxAttempts, OFFLINE_EVIDENCE_MAX_ATTEMPTS);

      if (attempt >= this.maxAttempts || !failure.retryable || offlineBudgetSpent) {
        if (failureError) throw failureError;
        throw new ProviderResolveFailureError({
          providerId,
          code: failure.code,
          message:
            attempt >= this.maxAttempts && failure.code === "not-found"
              ? `Provider ${providerId} did not return a stream after ${this.maxAttempts} attempts`
              : failure.message,
          retryable: false,
          at: this.now(),
        });
      }

      observer?.({
        type: "provider-retry-scheduled",
        providerId,
        nextAttempt: attempt + 1,
        at: this.now(),
        delayMs: this.retryDelayMs,
      });
      if (this.retryDelayMs > 0) {
        await this.sleepWithAbort(this.retryDelayMs, signal);
      }
    }

    throw new Error(`Provider ${providerId} exhausted after ${this.maxAttempts} attempts`);
  }

  async resolveWithFallback(
    input: ProviderResolveInput,
    candidateIds: readonly ProviderId[],
    signal?: AbortSignal,
    observer?: ProviderEngineObserver,
  ): Promise<ProviderEngineResolveOutput> {
    const usable = candidateIds.filter((id): id is ProviderId => Boolean(id));
    if (this.hedgeDelayMs <= 0 || usable.length <= 1) {
      return this.resolveSequentially(input, candidateIds, signal, observer);
    }
    return this.resolveHedged(input, usable, signal, observer);
  }

  private async resolveSequentially(
    input: ProviderResolveInput,
    candidateIds: readonly ProviderId[],
    signal?: AbortSignal,
    observer?: ProviderEngineObserver,
  ): Promise<ProviderEngineResolveOutput> {
    const attempts: ProviderEngineResolveAttempt[] = [];
    const offlineEvidence = new OfflineEvidenceTracker(this.consecutiveOfflineThreshold);

    for (let index = 0; index < candidateIds.length; index++) {
      const providerId = candidateIds[index];
      if (!providerId) continue;
      if (signal?.aborted) break;

      try {
        const result = await this.resolve(input, providerId, signal, observer);
        attempts.push({ providerId, result });
        return { result, providerId, attempts };
      } catch (error) {
        if (signal?.aborted) break;

        const failure: ProviderFailure =
          error instanceof ProviderResolveFailureError
            ? error.failure
            : {
                providerId,
                code: "unknown",
                message: error instanceof Error ? error.message : String(error),
                retryable: true,
                at: this.now(),
              };

        attempts.push({
          providerId,
          failure,
          ...(error instanceof ProviderResolveFailureError && error.result
            ? { result: error.result }
            : {}),
        });

        const verdict = offlineEvidence.record(providerId, failure);
        const nextProviderId = candidateIds[index + 1];

        // Offline evidence only ends the chain once enough *distinct* providers
        // agree. One domain failing to resolve is not proof the uplink is down,
        // and abandoning the remaining candidates on that basis strands the
        // user on a network that is merely glitchy.
        if (verdict === "offline") {
          if (nextProviderId) {
            observer?.({
              type: "provider-fallback-halted",
              fromProviderId: providerId,
              skippedProviderIds: candidateIds.slice(index + 1).filter(Boolean),
              reason: "offline",
              at: this.now(),
              failure,
            });
          }
          break;
        }

        if (!nextProviderId) break;

        observer?.({
          type: "provider-fallback-started",
          fromProviderId: providerId,
          toProviderId: nextProviderId,
          at: this.now(),
          failure,
        });
      }
    }

    return {
      result: null,
      providerId: null,
      attempts,
    };
  }

  /**
   * Overlapping fallback. Sequential fallback gives a slow provider the whole
   * resolve budget before the next one is even contacted, so a 12s timeout with
   * 2 attempts burns 24s of a 45s budget on one candidate. Hedging starts the
   * next candidate after `hedgeDelayMs` and takes whichever finishes first.
   *
   * Losing candidates are aborted as soon as a winner appears, so at most
   * `maxConcurrentCandidates` providers are ever in flight.
   */
  private async resolveHedged(
    input: ProviderResolveInput,
    candidateIds: readonly ProviderId[],
    signal?: AbortSignal,
    observer?: ProviderEngineObserver,
  ): Promise<ProviderEngineResolveOutput> {
    type SettlementBase = { readonly index: number; readonly providerId: ProviderId };
    type Settlement =
      | (SettlementBase & { readonly kind: "success"; readonly result: ProviderResolveResult })
      | (SettlementBase & {
          readonly kind: "failure";
          readonly failure: ProviderFailure;
          readonly result?: ProviderResolveResult;
        })
      | (SettlementBase & { readonly kind: "aborted" });

    type InFlight = {
      readonly index: number;
      readonly providerId: ProviderId;
      readonly controller: AbortController;
      readonly settled: Promise<Settlement>;
    };

    const indexedAttempts: Array<{ index: number; attempt: ProviderEngineResolveAttempt }> = [];
    const offlineEvidence = new OfflineEvidenceTracker(this.consecutiveOfflineThreshold);
    const inFlight = new Map<number, InFlight>();
    let nextIndex = 0;
    let halted = false;

    // Attempts settle out of order under hedging; callers still expect them in
    // candidate order, same as the sequential path.
    const orderedAttempts = (): ProviderEngineResolveAttempt[] =>
      [...indexedAttempts].sort((left, right) => left.index - right.index).map((it) => it.attempt);

    const abortAll = (reason?: unknown) => {
      for (const entry of inFlight.values()) entry.controller.abort(reason);
      inFlight.clear();
    };

    /** Starts the next untried candidate, or returns null when none remain. */
    const launchNext = (): ProviderId | null => {
      const providerId = candidateIds[nextIndex];
      if (!providerId) return null;
      const index = nextIndex++;
      const controller = new AbortController();
      if (signal?.aborted) controller.abort(signal.reason);

      const settled: Promise<Settlement> = this.resolve(
        input,
        providerId,
        controller.signal,
        observer,
      ).then(
        (result): Settlement => ({ kind: "success", index, providerId, result }),
        (error): Settlement => {
          if (error instanceof ProviderResolveAbortError || signal?.aborted) {
            return { kind: "aborted", index, providerId };
          }
          const failure: ProviderFailure =
            error instanceof ProviderResolveFailureError
              ? error.failure
              : {
                  providerId,
                  code: "unknown",
                  message: error instanceof Error ? error.message : String(error),
                  retryable: true,
                  at: this.now(),
                };
          return {
            kind: "failure",
            index,
            providerId,
            failure,
            ...(error instanceof ProviderResolveFailureError && error.result
              ? { result: error.result }
              : {}),
          };
        },
      );

      inFlight.set(index, { index, providerId, controller, settled });
      return providerId;
    };

    const onParentAbort = () => abortAll(signal?.reason);
    signal?.addEventListener("abort", onParentAbort, { once: true });

    try {
      if (signal?.aborted) return { result: null, providerId: null, attempts: [] };
      launchNext();

      while (inFlight.size > 0) {
        if (signal?.aborted) break;

        const canHedge =
          !halted &&
          nextIndex < candidateIds.length &&
          inFlight.size < this.maxConcurrentCandidates;

        let hedgeTimer: ReturnType<typeof setTimeout> | null = null;
        const racers: Array<Promise<Settlement | "hedge">> = [...inFlight.values()].map(
          (entry) => entry.settled,
        );
        if (canHedge) {
          racers.push(
            new Promise<"hedge">((resolve) => {
              hedgeTimer = setTimeout(() => resolve("hedge"), this.hedgeDelayMs);
            }),
          );
        }

        const outcome = await Promise.race(racers);
        if (hedgeTimer) clearTimeout(hedgeTimer);

        if (outcome === "hedge") {
          const slowest = [...inFlight.values()][0];
          const hedgedProviderId = launchNext();
          if (slowest && hedgedProviderId) {
            observer?.({
              type: "provider-hedge-started",
              fromProviderId: slowest.providerId,
              toProviderId: hedgedProviderId,
              at: this.now(),
              hedgeDelayMs: this.hedgeDelayMs,
            });
          }
          continue;
        }

        inFlight.delete(outcome.index);
        const providerId = outcome.providerId;

        if (outcome.kind === "aborted") continue;

        if (outcome.kind === "success") {
          indexedAttempts.push({
            index: outcome.index,
            attempt: { providerId, result: outcome.result },
          });
          abortAll(new ProviderResolveAbortError());
          return { result: outcome.result, providerId, attempts: orderedAttempts() };
        }

        indexedAttempts.push({
          index: outcome.index,
          attempt: {
            providerId,
            failure: outcome.failure,
            ...(outcome.result ? { result: outcome.result } : {}),
          },
        });

        if (offlineEvidence.record(providerId, outcome.failure) === "offline") {
          halted = true;
          const skipped = candidateIds.slice(nextIndex);
          if (skipped.length > 0) {
            observer?.({
              type: "provider-fallback-halted",
              fromProviderId: providerId,
              skippedProviderIds: skipped,
              reason: "offline",
              at: this.now(),
              failure: outcome.failure,
            });
          }
          // Candidates already in flight keep running — they may still succeed
          // and disprove the offline verdict. Only new launches stop.
          continue;
        }

        const nextProviderId = candidateIds[nextIndex];
        if (nextProviderId && inFlight.size < this.maxConcurrentCandidates) {
          observer?.({
            type: "provider-fallback-started",
            fromProviderId: providerId,
            toProviderId: nextProviderId,
            at: this.now(),
            failure: outcome.failure,
          });
          launchNext();
        }
      }

      return { result: null, providerId: null, attempts: orderedAttempts() };
    } finally {
      signal?.removeEventListener("abort", onParentAbort);
      abortAll(new ProviderResolveAbortError());
    }
  }

  private async resolveWithTimeout(
    module: CoreProviderModule,
    input: ProviderResolveInput,
    startedAt: string,
    signal?: AbortSignal,
  ): Promise<ProviderResolveResult | null> {
    if (signal?.aborted) throw this.abortError();

    const attemptController = new AbortController();
    const attemptSignal = attemptController.signal;
    const traceEvents: ProviderTraceEvent[] = [];

    const onParentAbort = () => attemptController.abort(signal?.reason);
    signal?.addEventListener("abort", onParentAbort, { once: true });

    const context: ProviderRuntimeContext = createProviderRuntimeContext({
      now: this.now,
      providerId: module.providerId,
      signal: attemptSignal,
      retryPolicy: {
        maxAttempts: this.maxAttempts,
        backoff: "none",
        delayMs: this.retryDelayMs,
      },
      fetch: resolveFetchPort(this.fetch, module.providerId),
      auth: this.auth,
      // Cancelling an attempt says nothing about the endpoint. Hedged fallback
      // aborts every losing candidate, so an unguarded port would let the
      // provider's own catch blocks quarantine healthy-but-slower endpoints.
      endpointHealth: this.endpointHealth
        ? guardEndpointHealthAgainstCancellation(this.endpointHealth, attemptSignal)
        : undefined,
      titleBridge: this.titleBridge,
      emit: (event) => traceEvents.push(event),
    });

    const operation = module.resolve(input, context);
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let onAbortReject: (() => void) | null = null;

    try {
      return await Promise.race([
        operation,
        new Promise<ProviderResolveResult | null>((_, reject) => {
          timeout = setTimeout(() => {
            // Typed so the health guard can tell "this endpoint was too slow"
            // (real evidence) from "we cancelled this attempt" (not evidence).
            attemptController.abort(new ProviderAttemptTimeoutError());
            const failure: ProviderFailure = {
              providerId: module.providerId,
              code: "timeout",
              message: `Provider did not return a stream within ${Math.round(this.attemptTimeoutMs / 1000)}s`,
              retryable: true,
              at: this.now(),
            };
            reject(
              new ProviderResolveFailureError(
                failure,
                createTimeoutResolveResult({
                  input,
                  providerId: module.providerId,
                  startedAt,
                  endedAt: failure.at,
                  events: traceEvents,
                  failure,
                }),
              ),
            );
          }, this.attemptTimeoutMs);

          onAbortReject = () => {
            if (timeout) clearTimeout(timeout);
            reject(this.abortError());
          };
          signal?.addEventListener("abort", onAbortReject, { once: true });
        }),
      ]);
    } catch (error) {
      if (error instanceof ProviderResolveFailureError) {
        throw error;
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", onParentAbort);
      if (onAbortReject) signal?.removeEventListener("abort", onAbortReject);
      if (timeout) clearTimeout(timeout);
    }
  }

  private sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw this.abortError();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(this.abortError());
        },
        { once: true },
      );
    });
  }

  private abortError(): Error {
    return new ProviderResolveAbortError();
  }
}

function createTimeoutResolveResult({
  input,
  providerId,
  startedAt,
  endedAt,
  events,
  failure,
}: {
  readonly input: ProviderResolveInput;
  readonly providerId: ProviderId;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly events: readonly ProviderTraceEvent[];
  readonly failure: ProviderFailure;
}): ProviderResolveResult {
  return {
    status: "exhausted",
    providerId,
    streams: [],
    subtitles: [],
    sources: [],
    variants: [],
    trace: {
      id: `trace:${providerId}:timeout:${Date.parse(startedAt) || 0}`,
      startedAt,
      endedAt,
      title: input.title,
      episode: input.episode,
      selectedProviderId: providerId,
      cacheHit: false,
      runtime: input.allowedRuntimes[0],
      steps: [],
      events,
      failures: [failure],
    },
    failures: [failure],
    healthDelta: {
      providerId,
      outcome: "failure",
      at: endedAt,
    },
  };
}

function failureFromResolveError(
  error: unknown,
  providerId: ProviderId,
  at: string,
): ProviderFailure {
  if (error instanceof ProviderResolveFailureError) return error.failure;
  return {
    providerId,
    code: "unknown",
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
    at,
  };
}

function elapsedMs(startedAt: string, finishedAt: string): number {
  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished)) return 0;
  return Math.max(0, finished - started);
}

function resolveFetchPort(
  fetchPort: ProviderFetchPort | ProviderFetchPortFactory | undefined,
  providerId: ProviderId,
): ProviderFetchPort | undefined {
  if (!fetchPort) return undefined;
  return typeof fetchPort === "function" ? fetchPort(providerId) : fetchPort;
}

export function createProviderEngine(opts: ProviderEngineOptions): ProviderEngine {
  return new ProviderEngine(opts);
}
