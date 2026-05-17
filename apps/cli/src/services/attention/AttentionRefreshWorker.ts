import type { AttentionFeatureFlags } from "@/domain/features/feature-flags";
import type { DiagnosticsStore } from "@/services/diagnostics/DiagnosticsStore";

import {
  planAttentionRefresh,
  type AttentionRefreshCandidate,
  type AttentionRefreshPlan,
} from "./AttentionRefreshScheduler";

export type AttentionRefreshWorkerStatus = "disabled" | "planned-only" | "completed" | "aborted";

export interface AttentionRefreshWorkerDeps {
  readonly flags: Pick<AttentionFeatureFlags, "providerAvailabilitySync">;
  readonly refreshAvailability?: (titleId: string, signal: AbortSignal) => Promise<void> | void;
  readonly diagnostics?: Pick<DiagnosticsStore, "record">;
}

export interface AttentionRefreshWorkerRunInput {
  readonly candidates: readonly AttentionRefreshCandidate[];
  readonly maxChecks: number;
  readonly now: string;
  readonly minIntervalMs: number;
  readonly signal?: AbortSignal;
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
    this.deps.diagnostics?.record({
      category: "runtime",
      message: "Attention refresh planned",
      context: {
        candidateCount: input.candidates.length,
        refreshCount: plan.refreshIds.length,
        skippedCount: plan.skipped.length,
        maxChecks: input.maxChecks,
      },
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
    const signal = input.signal ?? new AbortController().signal;
    for (const id of plan.refreshIds) {
      if (signal.aborted) {
        this.recordFinished("aborted", refreshedIds, failed);
        return {
          ...plan,
          status: "aborted",
          refreshedIds,
          failed,
        };
      }
      try {
        await this.deps.refreshAvailability(id, signal);
        refreshedIds.push(id);
      } catch (error) {
        failed.push({ id, error: String(error) });
      }
    }

    const status = signal.aborted ? "aborted" : "completed";
    this.recordFinished(status, refreshedIds, failed);
    return {
      ...plan,
      status,
      refreshedIds,
      failed,
    };
  }

  private recordFinished(
    status: Exclude<AttentionRefreshWorkerStatus, "disabled" | "planned-only">,
    refreshedIds: readonly string[],
    failed: readonly { readonly id: string; readonly error: string }[],
  ): void {
    this.deps.diagnostics?.record({
      category: "runtime",
      message: status === "aborted" ? "Attention refresh aborted" : "Attention refresh completed",
      context: {
        refreshCount: refreshedIds.length,
        failedCount: failed.length,
      },
    });
  }
}
