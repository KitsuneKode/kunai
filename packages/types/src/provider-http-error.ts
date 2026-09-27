import type { ProviderId, ResolveErrorCode } from "./index";

/**
 * An HTTP failure with the status attached.
 *
 * Thrown by provider transports so every downstream classifier — the provider
 * failure classifier, the cycle engine, endpoint quarantine — can act on the
 * status instead of re-deriving it from a message string. A provider that
 * throws `new Error("… HTTP 429")` loses the distinction the moment the string
 * is the only evidence left: the error reads as a retryable network blip, so a
 * persistent rate limit is retried to the attempt cap and never reaches the
 * quarantine gate (#458).
 */
export class ProviderHttpError extends Error {
  // Widened to `string` so subclasses can declare their own name.
  override readonly name: string = "ProviderHttpError";

  readonly providerId?: ProviderId | string;

  readonly stage?: string;

  readonly status?: number;

  readonly code: ResolveErrorCode;

  readonly retryable: boolean;

  constructor({
    message,
    providerId,
    stage,
    status,
    code,
    retryable,
    cause,
  }: {
    readonly message: string;
    readonly providerId?: ProviderId | string;
    readonly stage?: string;
    readonly status?: number;
    readonly code: ResolveErrorCode;
    readonly retryable: boolean;
    readonly cause?: unknown;
  }) {
    super(message, { cause });
    this.providerId = providerId;
    this.stage = stage;
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export function httpStatusToResolveErrorCode(status: number): ResolveErrorCode {
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate-limited";
  if (status === 401 || status === 403) return "blocked";
  if (status === 404) return "not-found";
  if (status >= 500) return "provider-unavailable";
  return "network-error";
}

export function httpStatusIsRetryable(status: number): boolean {
  return (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

/**
 * Canonical constructor for "the API answered a non-OK status" throws — one
 * mapping table instead of every provider re-deriving code/retryable itself.
 * The message stays caller-owned so existing message-level evidence (provider
 * name, endpoint label) keeps reading the same in diagnostics.
 */
export function providerHttpErrorForStatus(input: {
  readonly status: number;
  readonly message: string;
  readonly providerId?: ProviderId | string;
  readonly stage?: string;
  readonly cause?: unknown;
}): ProviderHttpError {
  return new ProviderHttpError({
    ...input,
    code: httpStatusToResolveErrorCode(input.status),
    retryable: httpStatusIsRetryable(input.status),
  });
}
