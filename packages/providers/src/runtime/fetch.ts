import type { ProviderId, ProviderRuntimeContext, ResolveErrorCode } from "@kunai/types";

export interface ProviderHttpRequestContext {
  readonly providerId?: ProviderId | string;
  readonly stage?: string;
}

export class ProviderHttpError extends Error {
  override readonly name = "ProviderHttpError";

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

function createProviderHttpError(
  response: Response,
  requestContext: ProviderHttpRequestContext | undefined,
): ProviderHttpError {
  return new ProviderHttpError({
    providerId: requestContext?.providerId,
    stage: requestContext?.stage,
    status: response.status,
    message: `Provider HTTP request failed with ${response.status} ${response.statusText}`.trim(),
    code: statusToResolveErrorCode(response.status),
    retryable: isRetryableStatus(response.status),
  });
}

export function statusToResolveErrorCode(status: number): ResolveErrorCode {
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate-limited";
  if (status === 401 || status === 403) return "blocked";
  if (status === 404) return "not-found";
  if (status >= 500) return "provider-unavailable";
  return "network-error";
}

export function isRetryableStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}
