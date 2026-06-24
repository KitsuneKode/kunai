import { classifyProviderFailure } from "@kunai/core";

import { type ErrorCode, type KitsuneError, createError } from "./errors";

export function kitsuneErrorFromProviderFailure(failure: unknown, message?: string): KitsuneError {
  const classified = classifyProviderFailure(failure);
  const code = mapProviderFailureClassToErrorCode(classified.failureClass);
  const normalized =
    failure && typeof failure === "object" && "providerId" in failure
      ? (failure as { providerId?: string })
      : undefined;
  return createError(code, message ?? classified.userSummary, {
    provider: normalized?.providerId,
    retryable: classified.retryable,
    cause: failure instanceof Error ? failure : undefined,
  });
}

export function kitsuneErrorFromUnknown(
  error: unknown,
  fallback: { code: ErrorCode; message: string; service?: string; retryable?: boolean },
): KitsuneError {
  if (error && typeof error === "object" && ("code" in error || "failureClass" in error)) {
    return kitsuneErrorFromProviderFailure(error, fallback.message);
  }
  if (error instanceof Error) {
    return createError(fallback.code, error.message || fallback.message, {
      service: fallback.service,
      retryable: fallback.retryable ?? false,
      cause: error,
    });
  }
  return createError(fallback.code, fallback.message, {
    service: fallback.service,
    retryable: fallback.retryable ?? false,
  });
}

function mapProviderFailureClassToErrorCode(failureClass: string): ErrorCode {
  switch (failureClass) {
    case "timeout":
    case "network":
    case "rate-limited":
      return "NETWORK_ERROR";
    case "provider-empty":
    case "expired-stream":
    case "title-episode-gap":
      return "STREAM_NOT_FOUND";
    case "user-cancelled":
      return "USER_CANCELLED";
    case "runtime-missing":
    case "provider-parse":
      return "CONFIG_ERROR";
    default:
      return "PROVIDER_UNAVAILABLE";
  }
}
