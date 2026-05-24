import { stat } from "node:fs/promises";

import type {
  OfflineMaintenanceJobRecord,
  OfflineMaintenanceJobsRepository,
  OfflineMaintenanceOperation,
} from "@kunai/storage";

import type { OfflineAssetService } from "./OfflineAssetService";

export type OfflineMaintenanceSummary = {
  readonly checked: number;
  readonly completed: number;
  readonly failed: number;
  readonly waitingPowerSaver: number;
  readonly waitingNetwork: number;
};

export class OfflineMaintenanceService {
  constructor(
    private readonly deps: {
      readonly jobs: Pick<
        OfflineMaintenanceJobsRepository,
        "enqueueUnique" | "listRunnable" | "markRunning" | "complete" | "fail"
      >;
      readonly assets: Pick<OfflineAssetService, "getAsset" | "markValidation">;
      readonly runOptionalOperation?: (
        job: OfflineMaintenanceJobRecord,
        operation: Exclude<OfflineMaintenanceOperation, "validate-file">,
      ) => Promise<void>;
    },
  ) {}

  scheduleForAsset(assetId: string, operation: OfflineMaintenanceOperation): void {
    this.deps.jobs.enqueueUnique({ assetId, operation, now: new Date().toISOString() });
  }

  async processNext(
    limit: number,
    context: { readonly networkAllowed: boolean; readonly powerSaver: boolean },
  ): Promise<OfflineMaintenanceSummary> {
    const summary = {
      checked: 0,
      completed: 0,
      failed: 0,
      waitingPowerSaver: 0,
      waitingNetwork: 0,
    };
    for (const job of this.deps.jobs.listRunnable(limit)) {
      summary.checked += 1;
      if (job.operation !== "validate-file" && context.powerSaver) {
        summary.waitingPowerSaver += 1;
        continue;
      }
      if (requiresNetwork(job.operation) && !context.networkAllowed) {
        summary.waitingNetwork += 1;
        continue;
      }
      const now = new Date().toISOString();
      this.deps.jobs.markRunning(job.id, now);
      try {
        if (job.operation === "validate-file") {
          await this.validateLocalAsset(job.assetId, now);
        } else if (this.deps.runOptionalOperation) {
          await this.deps.runOptionalOperation(job, job.operation);
        } else {
          throw new Error(`No local maintenance handler configured for ${job.operation}`);
        }
        this.deps.jobs.complete(job.id, new Date().toISOString());
        summary.completed += 1;
      } catch (error) {
        this.deps.jobs.fail(
          job.id,
          error instanceof Error ? error.message : String(error),
          new Date().toISOString(),
        );
        summary.failed += 1;
      }
    }
    return summary;
  }

  private async validateLocalAsset(assetId: string, validatedAt: string): Promise<void> {
    const asset = this.deps.assets.getAsset(assetId);
    if (!asset) throw new Error("offline asset is no longer present");
    const file = await stat(asset.filePath).catch(() => null);
    const state = file?.isFile() && file.size > 0 ? "ready" : "missing";
    this.deps.assets.markValidation(assetId, state, validatedAt);
  }
}

function requiresNetwork(operation: OfflineMaintenanceOperation): boolean {
  return operation === "repair-subtitle" || operation === "cache-poster";
}
