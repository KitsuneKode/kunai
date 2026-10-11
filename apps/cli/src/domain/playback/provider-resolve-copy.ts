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

  return "⇧F skips the remaining retries and tries the next provider.";
}

export function describeProviderResolveProviderNote(isFallback: boolean): string {
  return isFallback
    ? "Trying the next provider."
    : "Recoverable provider failures retry before fallback.";
}

export function describeProviderFallbackDetail({
  fromProviderName,
  toProviderName,
}: {
  readonly fromProviderName: string;
  readonly toProviderName: string;
}): string {
  return `${fromProviderName} did not resolve — trying ${toProviderName}`;
}

export function describeProviderHedgeNote({
  toProviderName,
}: {
  readonly toProviderName: string;
}): string {
  return `Also trying ${toProviderName} in parallel to speed this up.`;
}

export function describeProviderFallbackHaltedDetail(): string {
  return "Network looks offline — paused further provider fallback.";
}

export function describeProviderFallbackHaltedNote(): string {
  return "The attempt already in flight is still running.";
}
