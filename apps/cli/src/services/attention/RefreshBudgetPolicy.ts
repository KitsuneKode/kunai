export type AttentionRefreshDecisionReason =
  | "eligible"
  | "not-visible"
  | "not-followed"
  | "muted"
  | "budget-exhausted"
  | "too-soon";

export interface AttentionRefreshInput {
  readonly visible: boolean;
  readonly followed: boolean;
  readonly muted: boolean;
  readonly checksUsed: number;
  readonly maxChecks: number;
  readonly lastCheckedAt?: string;
  readonly now: string;
  readonly minIntervalMs: number;
}

export function shouldRefreshAttentionItem(input: AttentionRefreshInput): {
  readonly refresh: boolean;
  readonly reason: AttentionRefreshDecisionReason;
} {
  if (input.muted) return { refresh: false, reason: "muted" };
  if (!input.visible) return { refresh: false, reason: "not-visible" };
  if (!input.followed) return { refresh: false, reason: "not-followed" };
  if (input.checksUsed >= input.maxChecks) return { refresh: false, reason: "budget-exhausted" };
  if (
    input.lastCheckedAt !== undefined &&
    Date.parse(input.now) - Date.parse(input.lastCheckedAt) < input.minIntervalMs
  ) {
    return { refresh: false, reason: "too-soon" };
  }
  return { refresh: true, reason: "eligible" };
}
