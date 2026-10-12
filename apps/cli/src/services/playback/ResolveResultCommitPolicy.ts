export type ResolveCancellationReason =
  | "user-navigation"
  | "user-shutdown"
  | "provider-fallback"
  | "superseded-prefetch"
  | "timeout-budget"
  | "network-offline";

export type ResolveResultCommitAction = "persist-and-return" | "persist-only" | "discard";

export type ResolveResultCommitDecision = {
  readonly action: ResolveResultCommitAction;
  readonly reason:
    | "complete-active-result"
    | "late-valid-user-navigation"
    | "empty-result"
    | `aborted:${ResolveCancellationReason | "unknown"}`;
};

/**
 * Derive the cancellation reason carried on an aborted signal. The runtime
 * aborts resolve controllers with a reason (string or AbortError whose message
 * is the reason), so the commit decision cannot drift from the signal that
 * actually cancelled the work. Unrecognized reasons default to user
 * navigation — every ad-hoc cancel in the shell is user-initiated, and the
 * user-navigation outcome (keep a late valid result warm) is the safe bias.
 */
export function cancellationReasonFromSignal(
  signal: AbortSignal,
): ResolveCancellationReason | undefined {
  if (!signal.aborted) return undefined;
  // Producers use strings, Error, or DOMException. Arbitrary objects passed to
  // AbortController do not establish a cancellation policy. DOMException is
  // checked explicitly because it is not an Error subclass in every runtime.
  const raw: unknown = signal.reason;
  const error = raw instanceof Error || raw instanceof DOMException ? raw : undefined;
  const text = error?.message ?? (typeof raw === "string" ? raw : undefined);
  const name = error?.name;
  // `AbortSignal.timeout()` rejects with a DOMException named "TimeoutError"
  // whose message is "The operation timed out" — no "timeout" substring — so
  // the deadline can only be caught by name, before the text gates.
  if (name === "TimeoutError") return "timeout-budget";
  if (!text || /operation w?a?s? ?aborted/i.test(text)) return undefined;
  if (text.includes("fallback")) return "provider-fallback";
  if (text.includes("shutdown") || text.includes("app-exit")) return "user-shutdown";
  if (text.includes("prefetch")) return "superseded-prefetch";
  if (text.includes("timeout") || text.includes("timed out") || text.includes("deadline"))
    return "timeout-budget";
  if (text.includes("offline")) return "network-offline";
  return "user-navigation";
}

export function decideResolveResultCommit(input: {
  readonly hasResolvedStream: boolean;
  readonly signalAborted: boolean;
  readonly cancellationReason?: ResolveCancellationReason;
}): ResolveResultCommitDecision {
  if (!input.hasResolvedStream) return { action: "discard", reason: "empty-result" };
  if (!input.signalAborted) {
    return { action: "persist-and-return", reason: "complete-active-result" };
  }
  if (input.cancellationReason === "user-navigation") {
    return { action: "persist-only", reason: "late-valid-user-navigation" };
  }
  return {
    action: "discard",
    reason: `aborted:${input.cancellationReason ?? "unknown"}`,
  };
}
