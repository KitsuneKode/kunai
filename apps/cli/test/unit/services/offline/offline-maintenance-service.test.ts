import { describe, expect, test } from "bun:test";

import { OfflineMaintenanceService } from "@/services/offline/OfflineMaintenanceService";

function job(operation: "validate-file" | "repair-subtitle" = "validate-file") {
  return {
    id: `job-${operation}`,
    assetId: "asset-1",
    operation,
    status: "queued" as const,
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z",
  };
}

describe("OfflineMaintenanceService", () => {
  test("validates the selected local artifact without any network operation", async () => {
    const states: string[] = [];
    let optionalRuns = 0;
    const service = new OfflineMaintenanceService({
      jobs: {
        enqueueUnique: () => job(),
        listRunnable: () => [job()],
        markRunning: () => {},
        complete: () => {},
        fail: () => {},
      },
      assets: {
        getAsset: () => ({ filePath: import.meta.path }) as never,
        markValidation: (_id, state) => states.push(state),
      },
      runOptionalOperation: async () => {
        optionalRuns += 1;
      },
    });

    const summary = await service.processNext(1, { networkAllowed: false, powerSaver: true });

    expect(summary.completed).toBe(1);
    expect(states).toEqual(["ready"]);
    expect(optionalRuns).toBe(0);
  });

  test("power saver leaves optional network repair queued instead of running it", async () => {
    let running = 0;
    const service = new OfflineMaintenanceService({
      jobs: {
        enqueueUnique: () => job("repair-subtitle"),
        listRunnable: () => [job("repair-subtitle")],
        markRunning: () => {
          running += 1;
        },
        complete: () => {},
        fail: () => {},
      },
      assets: { getAsset: () => undefined, markValidation: () => {} },
      runOptionalOperation: async () => {
        throw new Error("must not run");
      },
    });

    const summary = await service.processNext(1, { networkAllowed: true, powerSaver: true });

    expect(summary.waitingPowerSaver).toBe(1);
    expect(running).toBe(0);
  });
});
