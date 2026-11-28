import type { ProviderId, ProviderRuntimeContext, StreamCandidate } from "@kunai/types";
import {
  httpStatusIsRetryable,
  httpStatusToResolveErrorCode,
  ProviderHttpError,
} from "@kunai/types";

import { providerFetch } from "../runtime/fetch";
import { directStreamFetchSignal } from "./direct-stream-source";
import { readJsonObjectBody } from "./json-body";

export type ProviderJsonRequestHeaders = NonNullable<StreamCandidate["headers"]>;
export type ProviderJsonFetchInit = Omit<RequestInit, "headers"> & {
  readonly headers?: ProviderJsonRequestHeaders;
};

export function createDirectProviderResponseFetch(
  providerId: ProviderId,
  label: string,
  timeoutMs: number,
) {
  return async (
    context: ProviderRuntimeContext,
    url: string,
    stage: string,
    init?: RequestInit,
  ): Promise<Response> => {
    const response = await providerFetch(context, url, {
      ...init,
      signal: directStreamFetchSignal(context.signal, timeoutMs),
      redirect: "error",
    });
    if (!response.ok) {
      const status = response.status;
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderHttpError({
        providerId,
        stage,
        status,
        message: `${label} ${stage} returned HTTP ${status}`,
        code: httpStatusToResolveErrorCode(status),
        retryable: httpStatusIsRetryable(status),
      });
    }
    return response;
  };
}

export function createProviderJsonFetch(options: {
  readonly providerId: ProviderId;
  readonly label: string;
  readonly origin: string;
  readonly userAgent: string;
  readonly timeoutMs: number;
}) {
  const baseHeaders: ProviderJsonRequestHeaders = {
    Accept: "application/json",
    Origin: options.origin,
    Referer: `${options.origin}/`,
    "User-Agent": options.userAgent,
  };
  return async function fetchProviderJson<T>(
    context: ProviderRuntimeContext,
    url: string,
    stage: string,
    init?: ProviderJsonFetchInit,
    messageStage = stage,
  ): Promise<T | null> {
    const response = await providerFetch(context, url, {
      ...init,
      headers: { ...baseHeaders, ...init?.headers },
      signal: directStreamFetchSignal(context.signal, options.timeoutMs),
    });
    if (!response.ok) {
      const status = response.status;
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderHttpError({
        providerId: options.providerId,
        stage,
        status,
        message: `${options.label} ${messageStage} returned HTTP ${status}`,
        code: status === 410 ? "not-found" : httpStatusToResolveErrorCode(status),
        retryable: httpStatusIsRetryable(status),
      });
    }
    return readJsonObjectBody<T>(response);
  };
}
