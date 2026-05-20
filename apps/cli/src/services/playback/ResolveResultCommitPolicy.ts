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
