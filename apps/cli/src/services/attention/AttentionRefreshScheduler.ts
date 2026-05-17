import {
  shouldRefreshAttentionItem,
  type AttentionRefreshDecisionReason,
} from "./RefreshBudgetPolicy";

export interface AttentionRefreshCandidate {
  readonly id: string;
  readonly visible: boolean;
  readonly followed: boolean;
  readonly muted: boolean;
  readonly lastCheckedAt?: string;
}

export interface AttentionRefreshPlanInput {
  readonly items: readonly AttentionRefreshCandidate[];
  readonly maxChecks: number;
  readonly now: string;
  readonly minIntervalMs: number;
}

export interface AttentionRefreshPlan {
  readonly refreshIds: readonly string[];
  readonly skipped: readonly {
    readonly id: string;
    readonly reason: AttentionRefreshDecisionReason;
  }[];
}

export function planAttentionRefresh(input: AttentionRefreshPlanInput): AttentionRefreshPlan {
  const refreshIds: string[] = [];
  const skipped: { id: string; reason: AttentionRefreshDecisionReason }[] = [];

  for (const item of input.items) {
    const decision = shouldRefreshAttentionItem({
      visible: item.visible,
      followed: item.followed,
      muted: item.muted,
      checksUsed: refreshIds.length,
      maxChecks: input.maxChecks,
      lastCheckedAt: item.lastCheckedAt,
      now: input.now,
      minIntervalMs: input.minIntervalMs,
    });
    if (decision.refresh) {
      refreshIds.push(item.id);
    } else {
      skipped.push({ id: item.id, reason: decision.reason });
    }
  }

  return { refreshIds, skipped };
}
