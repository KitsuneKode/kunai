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
  const raw: unknown = signal.reason;
  // DOMException (the reason for a bare abort() and for fetch-safe AbortError
  // reasons) is not an Error subclass in every runtime — read any message.
  const text =
    typeof raw === "string"
      ? raw
      : typeof raw === "object" &&
          raw !== null &&
          "message" in raw &&
          typeof raw.message === "string"
        ? raw.message
        : undefined;
  if (!text || /operation w?a?s? ?aborted/i.test(text)) return undefined;
  if (text.includes("fallback")) return "provider-fallback";
  if (text.includes("shutdown") || text.includes("app-exit")) return "user-shutdown";
  if (text.includes("prefetch")) return "superseded-prefetch";
  if (text.includes("timeout") || text.includes("deadline")) return "timeout-budget";
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
