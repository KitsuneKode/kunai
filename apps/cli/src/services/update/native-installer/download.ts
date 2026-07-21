import { createHash } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import { dirname } from "node:path";

export interface DownloadPolicy {
  readonly totalDeadlineMs: number;
  readonly stallDeadlineMs: number;
  readonly maxAttempts: number;
  readonly maxBytes: number;
  readonly retryBaseDelayMs: number;
}

/** Default native binary download policy (global S6). */
export const DEFAULT_BINARY_DOWNLOAD_POLICY: DownloadPolicy = {
  totalDeadlineMs: 300_000,
  stallDeadlineMs: 30_000,
  maxAttempts: 3,
  maxBytes: 256 * 1024 * 1024,
  retryBaseDelayMs: 1_000,
};

/** Checksum document policy: same deadlines/retries, 1 MiB cap. */
export const DEFAULT_CHECKSUM_DOWNLOAD_POLICY: DownloadPolicy = {
  ...DEFAULT_BINARY_DOWNLOAD_POLICY,
  maxBytes: 1024 * 1024,
};

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type DownloadResult = {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly attempts: number;
};

export type DownloadErrorCode =
  | "DOWNLOAD_HTTP"
  | "DOWNLOAD_STALL"
  | "DOWNLOAD_DEADLINE"
  | "DOWNLOAD_SIZE"
  | "DOWNLOAD_EMPTY"
  | "DOWNLOAD_INVALID_BODY"
  | "DOWNLOAD_ABORTED"
  | "DOWNLOAD_NETWORK";

export class DownloadError extends Error {
  readonly code: DownloadErrorCode;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(
    code: DownloadErrorCode,
    message: string,
    options: { readonly status?: number; readonly retryable: boolean; readonly cause?: unknown } = {
      retryable: false,
    },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "DownloadError";
    this.code = code;
    this.status = options.status;
    this.retryable = options.retryable;
  }
}

export function isRetryableDownloadError(error: unknown): boolean {
  if (error instanceof DownloadError) return error.retryable;
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; status?: unknown; retryable?: unknown };
  if (typeof value.retryable === "boolean") return value.retryable;
  if (value.code === "DOWNLOAD_STALL" || value.code === "DOWNLOAD_NETWORK") return true;
  if (value.code === "DOWNLOAD_DEADLINE" || value.code === "DOWNLOAD_ABORTED") return false;
  if (value.code === "DOWNLOAD_SIZE" || value.code === "DOWNLOAD_EMPTY") return false;
  if (value.code === "DOWNLOAD_INVALID_BODY") return false;
  if (value.code === "DOWNLOAD_HTTP" && typeof value.status === "number") {
    return isRetryableHttpStatus(value.status);
  }
  return false;
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; code?: unknown };
  return value.name === "AbortError" || value.code === "ABORT_ERR";
}

function mergePolicy(policy?: DownloadPolicy): DownloadPolicy {
  return { ...DEFAULT_BINARY_DOWNLOAD_POLICY, ...policy };
}

function remainingMs(deadlineAt: number): number {
  return Math.max(0, deadlineAt - Date.now());
}

function createDeadlineSignal(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  if (ms <= 0) {
    controller.abort(
      new DownloadError("DOWNLOAD_DEADLINE", "Download total deadline exceeded", {
        retryable: false,
      }),
    );
    return { signal: controller.signal, clear: () => {} };
  }
  const timer = setTimeout(() => {
    controller.abort(
      new DownloadError("DOWNLOAD_DEADLINE", "Download total deadline exceeded", {
        retryable: false,
      }),
    );
  }, ms);
  timer.unref?.();
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

function createStallWatch(
  stallDeadlineMs: number,
  onStall: () => void,
): { reset: () => void; clear: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  const reset = () => {
    clear();
    timer = setTimeout(onStall, stallDeadlineMs);
    timer.unref?.();
  };
  reset();
  return { reset, clear };
}

function linkSignals(signals: readonly AbortSignal[]): AbortSignal {
  const any = (
    AbortSignal as typeof AbortSignal & {
      any?: (input: readonly AbortSignal[]) => AbortSignal;
    }
  ).any;
  if (typeof any === "function") {
    return any(signals);
  }
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener(
      "abort",
      () => {
        if (!controller.signal.aborted) controller.abort(signal.reason);
      },
      { once: true },
    );
  }
  return controller.signal;
}

function abortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return new DownloadError("DOWNLOAD_ABORTED", "Download aborted", { retryable: false });
}

function whenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(abortReason(signal));
      return;
    }
    signal.addEventListener(
      "abort",
      () => {
        reject(abortReason(signal));
      },
      { once: true },
    );
  });
}

async function cleanupPartial(path: string): Promise<void> {
  await rm(path, { force: true }).catch(() => {});
}

async function streamResponseToFile(input: {
  readonly response: Response;
  readonly destinationPath: string;
  readonly maxBytes: number;
  readonly stallDeadlineMs: number;
  readonly signal: AbortSignal;
}): Promise<{ readonly sizeBytes: number; readonly sha256: string }> {
  const contentLength = input.response.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > input.maxBytes) {
      throw new DownloadError(
        "DOWNLOAD_SIZE",
        `Content-Length ${declared} exceeds size limit of ${input.maxBytes} bytes`,
        { retryable: false },
      );
    }
  }

  if (!input.response.body) {
    throw new DownloadError("DOWNLOAD_INVALID_BODY", "Response body is missing", {
      retryable: false,
    });
  }

  await mkdir(dirname(input.destinationPath), { recursive: true });
  await cleanupPartial(input.destinationPath);

  const hash = createHash("sha256");
  let sizeBytes = 0;
  let stalled = false;
  const stallController = new AbortController();
  const stall = createStallWatch(input.stallDeadlineMs, () => {
    stalled = true;
    stallController.abort(
      new DownloadError(
        "DOWNLOAD_STALL",
        "Download stalled: no data received within stall deadline",
        { retryable: true },
      ),
    );
  });

  const combined = linkSignals([input.signal, stallController.signal]);
  const reader = input.response.body.getReader();
  const handle = await open(input.destinationPath, "w");

  try {
    while (true) {
      const readResult = await Promise.race([reader.read(), whenAborted(combined)]);
      if (readResult.done) break;

      const bytes = readResult.value;
      sizeBytes += bytes.byteLength;
      if (sizeBytes > input.maxBytes) {
        throw new DownloadError(
          "DOWNLOAD_SIZE",
          `Downloaded size exceeded limit of ${input.maxBytes} bytes`,
          { retryable: false },
        );
      }
      hash.update(bytes);
      stall.reset();
      await handle.write(bytes);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    await handle.close().catch(() => {});
    await cleanupPartial(input.destinationPath);
    stall.clear();

    if (stalled || (error instanceof DownloadError && error.code === "DOWNLOAD_STALL")) {
      throw new DownloadError(
        "DOWNLOAD_STALL",
        "Download stalled: no data received within stall deadline",
        { retryable: true, cause: error },
      );
    }
    if (error instanceof DownloadError) throw error;
    if (isAbortError(error) || combined.aborted) {
      const reason = combined.reason;
      if (reason instanceof DownloadError) throw reason;
      throw new DownloadError("DOWNLOAD_ABORTED", "Download aborted", {
        retryable: false,
        cause: error,
      });
    }
    throw new DownloadError(
      "DOWNLOAD_NETWORK",
      error instanceof Error ? error.message : "Download stream failed",
      { retryable: true, cause: error },
    );
  } finally {
    stall.clear();
    await handle.close().catch(() => {});
  }

  if (sizeBytes === 0) {
    await cleanupPartial(input.destinationPath);
    throw new DownloadError("DOWNLOAD_EMPTY", "Downloaded zero bytes", { retryable: false });
  }

  return { sizeBytes, sha256: hash.digest("hex") };
}

async function attemptDownload(input: {
  readonly url: string;
  readonly destinationPath: string;
  readonly fetchImpl: FetchLike;
  readonly policy: DownloadPolicy;
  readonly signal: AbortSignal;
  readonly deadlineAt: number;
}): Promise<{ readonly sizeBytes: number; readonly sha256: string }> {
  const remaining = remainingMs(input.deadlineAt);
  if (remaining <= 0 || input.signal.aborted) {
    if (input.signal.aborted && input.signal.reason instanceof DownloadError) {
      throw input.signal.reason;
    }
    throw new DownloadError("DOWNLOAD_DEADLINE", "Download total deadline exceeded", {
      retryable: false,
    });
  }

  const attemptDeadline = createDeadlineSignal(remaining);
  const combined = linkSignals([input.signal, attemptDeadline.signal]);

  try {
    let response: Response;
    try {
      response = await input.fetchImpl(input.url, { signal: combined });
    } catch (error) {
      if (error instanceof DownloadError) throw error;
      if (isAbortError(error) || combined.aborted) {
        const reason = combined.reason;
        if (reason instanceof DownloadError) throw reason;
        throw new DownloadError("DOWNLOAD_ABORTED", "Download aborted", {
          retryable: false,
          cause: error,
        });
      }
      throw new DownloadError(
        "DOWNLOAD_NETWORK",
        error instanceof Error ? error.message : "Network request failed",
        { retryable: true, cause: error },
      );
    }

    if (!response.ok) {
      throw new DownloadError("DOWNLOAD_HTTP", `Download failed with HTTP ${response.status}`, {
        status: response.status,
        retryable: isRetryableHttpStatus(response.status),
      });
    }

    return await streamResponseToFile({
      response,
      destinationPath: input.destinationPath,
      maxBytes: input.policy.maxBytes,
      stallDeadlineMs: input.policy.stallDeadlineMs,
      signal: combined,
    });
  } finally {
    attemptDeadline.clear();
  }
}

/**
 * Stream a URL to disk with total/stall deadlines, size bounds, retries, and
 * incremental SHA-256. Partial files are removed on failure.
 */
export async function downloadToFile(input: {
  readonly url: string;
  readonly destinationPath: string;
  readonly fetchImpl?: FetchLike;
  readonly policy?: DownloadPolicy;
  readonly signal?: AbortSignal;
}): Promise<DownloadResult> {
  const policy = mergePolicy(input.policy);
  const fetchImpl = input.fetchImpl ?? fetch;
  const callerSignal = input.signal;
  const deadlineAt = Date.now() + policy.totalDeadlineMs;
  const maxAttempts = Math.max(1, policy.maxAttempts);

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (callerSignal?.aborted) {
      throw new DownloadError("DOWNLOAD_ABORTED", "Download aborted", {
        retryable: false,
        cause: callerSignal.reason,
      });
    }

    try {
      const result = await attemptDownload({
        url: input.url,
        destinationPath: input.destinationPath,
        fetchImpl,
        policy,
        signal: callerSignal ?? new AbortController().signal,
        deadlineAt,
      });
      return {
        path: input.destinationPath,
        sizeBytes: result.sizeBytes,
        sha256: result.sha256,
        attempts: attempt,
      };
    } catch (error) {
      lastError = error;
      await cleanupPartial(input.destinationPath);

      const retryable = isRetryableDownloadError(error);
      const budgetLeft = remainingMs(deadlineAt);
      if (!retryable || attempt >= maxAttempts || budgetLeft <= 0) {
        if (
          budgetLeft <= 0 &&
          retryable &&
          !(error instanceof DownloadError && error.code === "DOWNLOAD_DEADLINE")
        ) {
          throw new DownloadError("DOWNLOAD_DEADLINE", "Download total deadline exceeded", {
            retryable: false,
            cause: error,
          });
        }
        throw error;
      }

      const delay = Math.min(policy.retryBaseDelayMs * attempt, budgetLeft);
      if (delay > 0) await Bun.sleep(delay);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new DownloadError("DOWNLOAD_NETWORK", "Download failed after all retries", {
        retryable: false,
      });
}
