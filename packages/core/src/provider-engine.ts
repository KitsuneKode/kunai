import type {
  ProviderFailure,
  ProviderId,
  ProviderResolveInput,
  ProviderResolveResult,
  ProviderRuntimeContext,
} from "@kunai/types";

import type { CoreProviderModule } from "./provider-sdk";
import { ProviderResolveAbortError, ProviderResolveFailureError } from "./resolver";

export interface ProviderEngineOptions {
  readonly modules: readonly CoreProviderModule[];
  readonly maxAttempts?: number;
  readonly attemptTimeoutMs?: number;
  readonly retryDelayMs?: number;
}

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

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 250;

export class ProviderEngine {
  private readonly modulesById = new Map<ProviderId, CoreProviderModule>();
  readonly modules: readonly CoreProviderModule[];
  private readonly maxAttempts: number;
  private readonly attemptTimeoutMs: number;
  private readonly retryDelayMs: number;

  constructor(opts: ProviderEngineOptions) {
    this.modules = opts.modules;
    this.maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.attemptTimeoutMs = opts.attemptTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

    for (const module of opts.modules) {
      if (this.modulesById.has(module.providerId)) {
        throw new Error(`Duplicate provider module id: ${module.providerId}`);
      }
      this.modulesById.set(module.providerId, module);
    }
  }

  get(providerId: ProviderId): CoreProviderModule | undefined {
    return this.modulesById.get(providerId);
  }

  getManifest(providerId: ProviderId) {
    return this.modulesById.get(providerId)?.manifest;
  }

  getProviderIds(): ProviderId[] {
    return [...this.modulesById.keys()];
  }

  async resolve(
    input: ProviderResolveInput,
    providerId: ProviderId,
    signal?: AbortSignal,
  ): Promise<ProviderResolveResult> {
    const module = this.modulesById.get(providerId);
    if (!module) {
      throw new Error(`Provider module not found: ${providerId}`);
    }

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      if (signal?.aborted) throw this.abortError();

      const result = await this.resolveWithTimeout(module, input, signal);

      if (result) return result;

      if (signal?.aborted) throw this.abortError();

      if (attempt >= this.maxAttempts) {
        throw new ProviderResolveFailureError({
          providerId,
          code: "not-found",
          message: `Provider ${providerId} did not return a stream after ${this.maxAttempts} attempts`,
          retryable: false,
          at: new Date().toISOString(),
        });
      }

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
  ): Promise<ProviderEngineResolveOutput> {
    const attempts: ProviderEngineResolveAttempt[] = [];

    for (const providerId of candidateIds) {
      if (signal?.aborted) break;

      try {
        const result = await this.resolve(input, providerId, signal);
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
                at: new Date().toISOString(),
              };

        attempts.push({ providerId, failure });
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
    signal?: AbortSignal,
  ): Promise<ProviderResolveResult | null> {
    if (signal?.aborted) throw this.abortError();

    const attemptController = new AbortController();
    const attemptSignal = attemptController.signal;

    const onParentAbort = () => attemptController.abort(signal?.reason);
    signal?.addEventListener("abort", onParentAbort, { once: true });

    const context: ProviderRuntimeContext = {
      now: () => new Date().toISOString(),
      signal: attemptSignal,
      retryPolicy: {
        maxAttempts: this.maxAttempts,
        backoff: "none",
        delayMs: this.retryDelayMs,
      },
    };

    const operation = module.resolve(input, context);
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let onAbortReject: (() => void) | null = null;

    try {
      return await Promise.race([
        operation,
        new Promise<ProviderResolveResult | null>((_, reject) => {
          timeout = setTimeout(() => {
            attemptController.abort(new Error("provider resolve timeout"));
            reject(
              new ProviderResolveFailureError({
                providerId: module.providerId,
                code: "timeout",
                message: `Provider did not return a stream within ${Math.round(this.attemptTimeoutMs / 1000)}s`,
                retryable: true,
                at: new Date().toISOString(),
              }),
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

export function createProviderEngine(opts: ProviderEngineOptions): ProviderEngine {
  return new ProviderEngine(opts);
}
