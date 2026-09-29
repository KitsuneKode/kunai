import {
  httpStatusIsRetryable,
  httpStatusToResolveErrorCode,
  ProviderHttpError,
  providerHttpErrorForStatus,
  type ProviderId,
  type ProviderRuntimeContext,
} from "@kunai/types";

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
  return context.fetch?.fetch(input, init) ?? fetch(input, init);
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
