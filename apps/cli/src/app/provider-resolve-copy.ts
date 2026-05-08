export type ProviderResolveAttemptCopyInput = {
  readonly providerName: string;
  readonly attempt: number;
  readonly maxAttempts: number;
};

export function describeProviderResolveAttemptDetail({
  providerName,
  attempt,
  maxAttempts,
}: ProviderResolveAttemptCopyInput): string {
  return attempt <= 1
    ? `Resolving via ${providerName} (${attempt}/${maxAttempts})`
    : `Retrying ${providerName} (${attempt}/${maxAttempts})`;
}

export function describeProviderResolveAttemptNote({
  attempt,
  maxAttempts,
}: Pick<ProviderResolveAttemptCopyInput, "attempt" | "maxAttempts">): string {
  if (maxAttempts <= 1) {
    return "Fallback remains available if this provider stalls.";
  }

  if (attempt <= 1) {
    return "Kunai will retry recoverable provider failures before fallback.";
  }

  if (attempt >= maxAttempts) {
    return "Final retry for this provider; fallback remains available.";
  }

  return "f skips the remaining retries and tries the next provider.";
}

export function describeProviderResolveProviderNote(isFallback: boolean): string {
  return isFallback
    ? "Trying the next compatible provider now."
    : "Recoverable provider failures retry before fallback.";
}
