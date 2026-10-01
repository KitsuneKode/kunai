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

  /**
   * The upstream's own cooldown hint, when it sent one (`Retry-After`), in
   * milliseconds from the moment the response arrived. Consumed by the cycle
   * engine as a retry-delay floor and by endpoint health as a cooldown floor —
   * a 429 that says "come back in 60s" should not be re-asked in 750ms.
   */
  readonly retryAfterMs?: number;

  constructor({
    message,
    providerId,
    stage,
    status,
    code,
    retryable,
    retryAfterMs,
    cause,
  }: {
    readonly message: string;
    readonly providerId?: ProviderId | string;
    readonly stage?: string;
    readonly status?: number;
    readonly code: ResolveErrorCode;
    readonly retryable: boolean;
    readonly retryAfterMs?: number;
    readonly cause?: unknown;
  }) {
    super(message, { cause });
    this.providerId = providerId;
    this.stage = stage;
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * The longest a `Retry-After` hint is honored. A hostile or sloppy upstream
 * sending `Retry-After: 86400` must not park an endpoint for a day — the hint
 * is a floor on the local cooldown, never a veto over it.
 */
export const RETRY_AFTER_CAP_MS = 15 * 60 * 1000;

/**
 * Parse a `Retry-After` header value into milliseconds-from-now. Supports the
 * two real forms — integer seconds and HTTP-date — and clamps hostile values
 * to {@link RETRY_AFTER_CAP_MS}. Returns undefined for absent/malformed input.
 */
export function parseRetryAfterHeader(
  value: string | null | undefined,
  now = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number(trimmed) * 1000, RETRY_AFTER_CAP_MS);
  }
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.min(Math.max(0, at - now), RETRY_AFTER_CAP_MS);
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
 * Read a `Retry-After` hint off any thrown value — `ProviderHttpError` and its
 * subclasses carry it as a field, and the duck-typed read keeps working for
 * errors reconstituted across a serialization boundary. Anything else returns
 * undefined.
 */
export function errorRetryAfterMs(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const value = (error as { readonly retryAfterMs?: unknown }).retryAfterMs;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
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
  readonly retryAfterMs?: number;
  readonly cause?: unknown;
}): ProviderHttpError {
  return new ProviderHttpError({
    ...input,
    code: httpStatusToResolveErrorCode(input.status),
    retryable: httpStatusIsRetryable(input.status),
  });
}
