import type { AttentionFeatureFlags } from "@/domain/features/feature-flags";

import {
  planAttentionRefresh,
  type AttentionRefreshCandidate,
  type AttentionRefreshPlan,
} from "./AttentionRefreshScheduler";

export type AttentionRefreshWorkerStatus = "disabled" | "planned-only" | "completed";

export interface AttentionRefreshWorkerDeps {
  readonly flags: Pick<AttentionFeatureFlags, "providerAvailabilitySync">;
  readonly refreshAvailability?: (titleId: string) => Promise<void> | void;
}

export interface AttentionRefreshWorkerRunInput {
  readonly candidates: readonly AttentionRefreshCandidate[];
  readonly maxChecks: number;
  readonly now: string;
  readonly minIntervalMs: number;
}

export interface AttentionRefreshWorkerResult extends AttentionRefreshPlan {
  readonly status: AttentionRefreshWorkerStatus;
  readonly refreshedIds: readonly string[];
  readonly failed: readonly { readonly id: string; readonly error: string }[];
}

export class AttentionRefreshWorker {
  constructor(private readonly deps: AttentionRefreshWorkerDeps) {}

  async runOnce(input: AttentionRefreshWorkerRunInput): Promise<AttentionRefreshWorkerResult> {
    if (!this.deps.flags.providerAvailabilitySync) {
      return {
        status: "disabled",
        refreshIds: [],
        skipped: [],
        refreshedIds: [],
        failed: [],
      };
    }

    const plan = planAttentionRefresh({
      items: input.candidates,
      maxChecks: input.maxChecks,
      now: input.now,
      minIntervalMs: input.minIntervalMs,
    });

    if (!this.deps.refreshAvailability) {
      return {
        ...plan,
        status: "planned-only",
        refreshedIds: [],
        failed: [],
      };
    }

    const refreshedIds: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const id of plan.refreshIds) {
      try {
        await this.deps.refreshAvailability(id);
        refreshedIds.push(id);
      } catch (error) {
        failed.push({ id, error: String(error) });
      }
    }

    return {
      ...plan,
      status: "completed",
      refreshedIds,
      failed,
    };
  }
}
