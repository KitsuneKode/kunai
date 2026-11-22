import {
  httpStatusIsRetryable,
  httpStatusToResolveErrorCode,
  ProviderHttpError,
  providerHttpErrorForStatus,
  type ProviderId,
  type ProviderRuntimeContext,
} from "@kunai/types";

import { isHotfixSuppliedUrl } from "../shared/hotfix-runtime";
import { isSafeManifestHttpsUrl } from "../shared/manifest-bundle";

// The error contract lives in @kunai/types so the cycle engine's classifier
// can read status/code/retryable instead of string-matching messages (#458).
// Re-exported here to keep the long-standing import path stable.
export { ProviderHttpError, providerHttpErrorForStatus };

export interface ProviderHttpRequestContext {
  readonly providerId?: ProviderId | string;
  readonly stage?: string;
}

export function providerFetch(
  context: ProviderRuntimeContext,
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const send = (target: string | URL | Request, options?: RequestInit) =>
    context.fetch?.fetch(target, options) ?? fetch(target, options);
  const url = input instanceof Request ? null : input instanceof URL ? input.href : input;
  if (url !== null && init?.redirect === undefined && isHotfixSuppliedUrl(url)) {
    return fetchWithCheckedRedirects(send, url, init);
  }
  return send(input, init);
}

const MAX_CHECKED_REDIRECTS = 5;

/**
 * Follow redirects by hand so every hop passes the same public-HTTPS,
 * no-credentials, no-private-host check the manifest's own URLs passed. A
 * signed mirror on a public host must not be able to hand the next request to
 * loopback or link-local.
 */
async function fetchWithCheckedRedirects(
  send: (target: string, options?: RequestInit) => Promise<Response>,
  url: string,
  init: RequestInit | undefined,
): Promise<Response> {
  let current = url;
  let options: RequestInit = { ...init, redirect: "manual" };
  for (let hop = 0; hop <= MAX_CHECKED_REDIRECTS; hop++) {
    const response = await send(current, options);
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) return response;
    await response.body?.cancel().catch(() => undefined);
    const next = new URL(location, current).href;
    if (!isSafeManifestHttpsUrl(next)) {
      throw new ProviderHttpError({
        message:
          "Redirect from a hotfix-supplied host to a non-public or non-HTTPS target was refused",
        code: "blocked",
        retryable: false,
        status: response.status,
      });
    }
    const method = (options.method ?? "GET").toUpperCase();
    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) && method === "POST")
    ) {
      options = { ...options, method: "GET", body: undefined };
    }
    current = next;
  }
  throw new ProviderHttpError({
    message: `More than ${MAX_CHECKED_REDIRECTS} redirects from a hotfix-supplied host`,
    code: "network-error",
    retryable: false,
  });
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

  try {
    return (await response.json()) as T;
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
