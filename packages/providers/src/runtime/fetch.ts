import {
  httpStatusIsRetryable,
  httpStatusToResolveErrorCode,
  ProviderHttpError,
  providerHttpErrorForStatus,
  type ProviderId,
  type ProviderRuntimeContext,
} from "@kunai/types";

import { readResponseTextCapped } from "../shared/bounded-body";
import { createGuardedFetch, PROVIDER_API_SENSITIVE_HEADERS } from "../shared/stream-reachability";

const PROVIDER_JSON_MAX_BYTES = 8 * 1024 * 1024;

// The error contract lives in @kunai/types so the cycle engine's classifier
// can read status/code/retryable instead of string-matching messages (#458).
// Re-exported here to keep the long-standing import path stable.
export { ProviderHttpError, providerHttpErrorForStatus };

const guardedDirectFetch = createGuardedFetch({
  extraSensitiveHeaders: PROVIDER_API_SENSITIVE_HEADERS,
  // User-configured endpoints (self-hosted Invidious/Piped) are legitimately
  // private; only redirect hops are attacker-controlled and stay guarded.
  allowInitialPrivateTarget: true,
});

export interface ProviderHttpRequestContext {
  readonly providerId?: ProviderId | string;
  readonly stage?: string;
}

export function providerFetch(
  context: ProviderRuntimeContext | undefined,
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  // The port itself decides whether a request can ride the relay — hosts
  // outside `upstreamHosts` fall back to direct — so `context` is optional
  // only where a shared helper genuinely has no caller context to take.
  // Context-free calls still run the private-target + redirect guard rather
  // than raw fetch: a provider redirect must not carry secrets cross-origin.
  return context?.fetch?.fetch(input, init) ?? guardedDirectFetch(input, init);
}

export async function providerJson<T>(
  context: ProviderRuntimeContext,
  input: string | URL | Request,
  init?: RequestInit,
): Promise<T>;
export async function providerJson<T>(
  context: ProviderRuntimeContext,
  input: string | URL | Request,
  requestContext?: ProviderHttpRequestContext,
): Promise<T>;
export async function providerJson<T>(
  context: ProviderRuntimeContext,
  input: string | URL | Request,
  init?: RequestInit,
  requestContext?: ProviderHttpRequestContext,
): Promise<T>;
export async function providerJson<T>(
  context: ProviderRuntimeContext,
  input: string | URL | Request,
  initOrContext?: RequestInit | ProviderHttpRequestContext,
  maybeContext?: ProviderHttpRequestContext,
): Promise<T> {
  const { init, requestContext } = splitProviderJsonArgs(initOrContext, maybeContext);
  const response = await providerFetch(context, input, init);

  if (!response.ok) {
    throw createProviderHttpError(response, requestContext);
  }

  // Provider JSON is KBs, not MBs — an unbounded body is a memory vector, not
  // a payload, so the read is capped before the parse sees it.
  const text = await readResponseTextCapped(response, PROVIDER_JSON_MAX_BYTES);
  if (text === null) {
    throw new ProviderHttpError({
      providerId: requestContext?.providerId,
      stage: requestContext?.stage,
      message: `Provider JSON response unreadable or exceeds ${PROVIDER_JSON_MAX_BYTES} bytes`,
      code: "network-error",
      retryable: true,
    });
  }
  try {
    // SAFETY: T is the caller-declared payload contract; JSON.parse is untyped by spec.
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new ProviderHttpError({
      providerId: requestContext?.providerId,
      stage: requestContext?.stage,
      message: `Failed to parse provider JSON response`,
      code: "parse-failed",
      retryable: false,
      cause,
    });
  }
}

function splitProviderJsonArgs(
  initOrContext: RequestInit | ProviderHttpRequestContext | undefined,
  maybeContext: ProviderHttpRequestContext | undefined,
): { readonly init?: RequestInit; readonly requestContext?: ProviderHttpRequestContext } {
  if (!initOrContext || isRequestInit(initOrContext)) {
    return { init: initOrContext, requestContext: maybeContext };
  }
  return { requestContext: initOrContext };
}

function isRequestInit(value: RequestInit | ProviderHttpRequestContext): value is RequestInit {
  return (
    "body" in value ||
    "cache" in value ||
    "credentials" in value ||
    "headers" in value ||
    "method" in value ||
    "mode" in value ||
    "redirect" in value ||
    "referrer" in value ||
    "signal" in value
  );
}

export function createProviderHttpError(
  response: Response,
  requestContext: ProviderHttpRequestContext | undefined,
): ProviderHttpError {
  return new ProviderHttpError({
    providerId: requestContext?.providerId,
    stage: requestContext?.stage,
    status: response.status,
    message: `Provider HTTP request failed with ${response.status} ${response.statusText}`.trim(),
    code: httpStatusToResolveErrorCode(response.status),
    retryable: httpStatusIsRetryable(response.status),
  });
}
