import type { ProviderId, RelayErrorCode } from "./index";

/**
 * The relay's own refusal, surfaced as a thrown error instead of a Response.
 *
 * The relay marks refusal envelopes with its error-code header — a stale
 * deployment answering `unknown-provider`, an auth failure, a policy block —
 * and the handler strips that header from proxied upstream responses, so the
 * header can never mean "the upstream said this". The fetch port throws this
 * type for them rather than handing the provider a Response it would read as
 * an upstream verdict: a relayed `unknown-provider` 404 once flowed into
 * AniDB's missing-catalogue path and got cached as a content miss.
 *
 * Deliberately not a `ProviderHttpError`: the status is the refusal
 * envelope's, not an HTTP verdict about the resource, and none of the
 * downstream classifiers (offline tracking, endpoint quarantine, content-miss
 * caching) may act on it. The message likewise carries no transport vocabulary
 * — no "fetch failed", no DNS/errno wording — so a refusal can never be
 * misread as the user's network being down.
 */
export class RelayRefusalError extends Error {
  override readonly name = "RelayRefusalError";

  /** Distinctive marker — intentionally outside `ResolveErrorCode` vocabulary. */
  readonly code = "RELAY_REFUSAL" as const;

  /** The relay's refusal reason, verbatim from its error-code header. */
  readonly relayCode: RelayErrorCode;

  /** The relay-side provider id when the refusal names one. */
  readonly providerId?: ProviderId | string;

  /** HTTP status of the refusal envelope — the relay's voice, not upstream's. */
  readonly status: number;

  constructor(input: {
    readonly relayCode: RelayErrorCode;
    readonly providerId?: ProviderId | string;
    readonly status: number;
    readonly message?: string;
    readonly cause?: unknown;
  }) {
    super(input.message ?? `relay refused request (${input.relayCode})`, { cause: input.cause });
    this.relayCode = input.relayCode;
    this.providerId = input.providerId;
    this.status = input.status;
  }
}

export function isRelayRefusalError<T>(error: T): error is T & RelayRefusalError {
  return error instanceof RelayRefusalError;
}
