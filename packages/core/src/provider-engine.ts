import type {
  ProviderFailure,
  ProviderId,
  ProviderAuthPort,
  ProviderFetchPort,
  ProviderResolveInput,
  ProviderResolveResult,
  ProviderRuntimeContext,
  ProviderTraceEvent,
} from "@kunai/types";
import { isProviderResolveResultResolved } from "@kunai/types";

import type { CoreProviderModule } from "./provider-sdk";
import { createProviderRuntimeContext } from "./provider-sdk";
import {
  createProviderResolveFailureError,
  ProviderResolveAbortError,
  ProviderResolveFailureError,
} from "./resolver";

const PROVIDER_ID_ALIASES: Readonly<Record<string, ProviderId>> = {
  vidking: "videasy",
};

export function resolveProviderId(providerId: ProviderId): ProviderId {
  return PROVIDER_ID_ALIASES[providerId] ?? providerId;
}

export interface ProviderEngineOptions {
  readonly modules: readonly CoreProviderModule[];
  readonly maxAttempts?: number;
  readonly attemptTimeoutMs?: number;
  readonly retryDelayMs?: number;
  readonly now?: () => string;
  readonly auth?: ProviderAuthPort;
  readonly fetch?: ProviderFetchPort | ProviderFetchPortFactory;
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
    };

export type ProviderEngineObserver = (event: ProviderEngineEvent) => void;

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 250;

export class ProviderEngine {
  private readonly modulesById = new Map<ProviderId, CoreProviderModule>();
  readonly modules: readonly CoreProviderModule[];
  private readonly maxAttempts: number;
  private readonly attemptTimeoutMs: number;
  private readonly retryDelayMs: number;
  private readonly now: () => string;
  private readonly auth?: ProviderAuthPort;
  private readonly fetch?: ProviderFetchPort | ProviderFetchPortFactory;

  constructor(opts: ProviderEngineOptions) {
    this.modules = opts.modules;
    this.maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.attemptTimeoutMs = opts.attemptTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.now = opts.now ?? (() => new Date().toISOString());
    this.auth = opts.auth;
    this.fetch = opts.fetch;

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

      if (attempt >= this.maxAttempts || !failure.retryable || isOfflineNetworkFailure(failure)) {
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
    const attempts: ProviderEngineResolveAttempt[] = [];

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

        const nextProviderId = candidateIds[index + 1];
        if (nextProviderId) {
          observer?.({
            type: "provider-fallback-started",
            fromProviderId: providerId,
            toProviderId: nextProviderId,
            at: this.now(),
            failure,
          });
        }

        if (!nextProviderId) break;
      }
    }

    return {
      result: null,
      providerId: null,
      attempts,
    };
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
            attemptController.abort(new Error("provider resolve timeout"));
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

export function isOfflineNetworkFailure(failure: ProviderFailure): boolean {
  if (failure.code !== "network-error") return false;
  const message = failure.message.toLowerCase();
  return OFFLINE_NETWORK_PATTERNS.some((pattern) => message.includes(pattern));
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

const OFFLINE_NETWORK_PATTERNS = [
  "enotfound",
  "eai_again",
  "enetunreach",
  "network is unreachable",
  "err_internet_disconnected",
  "err_name_not_resolved",
];

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
