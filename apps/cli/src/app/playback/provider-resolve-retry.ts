import { ProviderResolveFailureError } from "@kunai/core";
import type { ProviderFailure } from "@kunai/types";

export { ProviderResolveFailureError } from "@kunai/core";

export type ProviderResolveRetryAttempt = {
  readonly providerId: string;
  readonly providerName: string;
  readonly attempt: number;
  readonly maxAttempts: number;
};

export type ProviderResolveRetryFailure = ProviderResolveRetryAttempt & {
  readonly issue: string;
  readonly retryable: boolean;
};

export async function resolveProviderStreamWithRetries<TStream>({
  providerId,
  providerName,
  maxAttempts,
  timeoutMs,
  retryDelayMs = 250,
  signal,
  resolve,
  onAttempt,
  onFailure,
}: {
  readonly providerId: string;
  readonly providerName: string;
  readonly maxAttempts: number;
  readonly timeoutMs: number;
  readonly retryDelayMs?: number;
  readonly signal: AbortSignal;
  readonly resolve: (signal: AbortSignal) => Promise<TStream | null>;
  readonly onAttempt?: (attempt: ProviderResolveRetryAttempt) => void;
  readonly onFailure?: (failure: ProviderResolveRetryFailure) => void;
}): Promise<TStream | null> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal.aborted) throw abortError();
    onAttempt?.({ providerId, providerName, attempt, maxAttempts });

    try {
      return await withAttemptTimeout({
        providerId,
        timeoutMs,
        parentSignal: signal,
        run: resolve,
      });
    } catch (error) {
      if (signal.aborted) throw abortError();

      lastError = error;
      const retryable = isRetryableProviderError(error);
      onFailure?.({
        providerId,
        providerName,
        attempt,
        maxAttempts,
        issue: describeProviderResolveIssue(providerId, error),
        retryable,
      });

      if (!retryable || attempt >= maxAttempts) {
        throw error;
      }

      if (retryDelayMs > 0) {
        await sleepWithAbort(retryDelayMs, signal);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function describeProviderResolveIssue(providerId: string, error: unknown): string {
  if (error instanceof ProviderResolveFailureError) {
    return formatFailure(providerId, error.failure);
  }
  if (error instanceof Error) {
    return `${providerId}: ${error.message}`;
  }
  return `${providerId}: ${String(error)}`;
}

function formatFailure(providerId: string, failure: ProviderFailure): string {
  return `${providerId}: ${failure.code} - ${failure.message}`;
}

function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof ProviderResolveFailureError) {
    return error.failure.retryable;
  }
  return true;
}

async function withAttemptTimeout<TStream>({
  providerId,
  timeoutMs,
  parentSignal,
  run,
}: {
  readonly providerId: string;
  readonly timeoutMs: number;
  readonly parentSignal: AbortSignal;
  readonly run: (signal: AbortSignal) => Promise<TStream | null>;
}): Promise<TStream | null> {
  if (parentSignal.aborted) throw abortError();

  const attemptController = new AbortController();
  const abortAttempt = () => attemptController.abort(parentSignal.reason);
  parentSignal.addEventListener("abort", abortAttempt, { once: true });

  const operation = run(attemptController.signal);
  operation.catch(() => undefined);
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let abortTimeout: (() => void) | null = null;

  try {
    return await Promise.race([
      operation,
      new Promise<TStream | null>((_, reject) => {
        timeout = setTimeout(() => {
          attemptController.abort(new Error("provider resolve timeout"));
          reject(
            new ProviderResolveFailureError({
              providerId,
              code: "timeout",
              message: `Provider did not return a stream within ${Math.round(timeoutMs / 1000)}s`,
              retryable: true,
              at: new Date().toISOString(),
            }),
          );
        }, timeoutMs);
        abortTimeout = () => {
          if (timeout) clearTimeout(timeout);
          reject(abortError());
        };
        parentSignal.addEventListener("abort", abortTimeout, { once: true });
      }),
    ]);
  } finally {
    parentSignal.removeEventListener("abort", abortAttempt);
    if (abortTimeout) parentSignal.removeEventListener("abort", abortTimeout);
    if (timeout) clearTimeout(timeout);
  }
}

async function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}

function abortError(): Error {
  return new Error("Provider resolve aborted");
}
