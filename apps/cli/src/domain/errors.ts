// =============================================================================
// Error Taxonomy
//
// Typed errors for consistent handling and recovery strategies.
// =============================================================================

export type ErrorCode =
  | "NETWORK_ERROR"
  | "PROVIDER_UNAVAILABLE"
  | "STREAM_NOT_FOUND"
  | "BROWSER_FAILED"
  | "PLAYER_FAILED"
  | "USER_CANCELLED"
  | "INVALID_STATE"
  | "CONFIG_ERROR";

export interface KitsuneError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly service?: string;
  readonly provider?: string;
  readonly retryable: boolean;
  readonly cause?: Error;
}

export function createError(
  code: ErrorCode,
  message: string,
  options?: {
    service?: string;
    provider?: string;
    retryable?: boolean;
    cause?: Error;
  },
): KitsuneError {
  return {
    code,
    message,
    service: options?.service,
    provider: options?.provider,
    retryable: options?.retryable ?? false,
    cause: options?.cause,
  };
}

export function isRetryable(error: KitsuneError): boolean {
  return error.retryable;
}

export function formatError(error: KitsuneError): string {
  const extras: string[] = [];
  if (error.service) extras.push(`service=${error.service}`);
  if (error.provider) extras.push(`provider=${error.provider}`);
  return [error.code, ...extras, error.message].join(" | ");
}
