import { describe, expect, test } from "bun:test";

import {
  launchShellWithPostPaintStartupWork,
  schedulePostPaintStartupWork,
} from "@/app/bootstrap/post-paint-startup-work";
import { BackgroundWorkScheduler } from "@/services/background/BackgroundWorkScheduler";

describe("post-paint startup work", () => {
  test("runs storage then cleanup after separate post-shell yields at production concurrency", async () => {
    const order: string[] = [];
    const releaseYield: Array<() => void> = [];
    let markCleanupYieldStarted!: () => void;
    const cleanupYieldStarted = new Promise<void>((resolve) => {
      markCleanupYieldStarted = resolve;
    });
    const scheduler = new BackgroundWorkScheduler({ maxConcurrent: 2 });

    const drain = launchShellWithPostPaintStartupWork({
      scheduler,
      launchShell: () => order.push("shell-launched"),
      recordShellMounted: () => order.push("shell-mounted"),
      yieldToPaint: () => {
        const task = releaseYield.length === 0 ? "storage" : "cleanup";
        order.push(`yielded-${task}`);
        if (task === "cleanup") markCleanupYieldStarted();
        return new Promise<void>((resolve) => {
          releaseYield.push(resolve);
        });
      },
      tasks: [
        {
          id: "storage-maintenance",
          run: () => {
            order.push("storage-maintenance");
          },
        },
        {
          id: "download-cleanup-scan",
          run: () => {
            order.push("download-cleanup");
          },
        },
      ],
    });

    await Promise.resolve();
    expect(order).toEqual(["shell-launched", "shell-mounted", "yielded-storage"]);
    releaseYield[0]?.();
    await cleanupYieldStarted;
    expect(order).toEqual([
      "shell-launched",
      "shell-mounted",
      "yielded-storage",
      "storage-maintenance",
      "yielded-cleanup",
    ]);
    releaseYield[1]?.();
    await drain;
    expect(order).toEqual([
      "shell-launched",
      "shell-mounted",
      "yielded-storage",
      "storage-maintenance",
      "yielded-cleanup",
      "download-cleanup",
    ]);
  });

  test("contains one maintenance failure and continues the other startup task", async () => {
    const scheduler = new BackgroundWorkScheduler({ maxConcurrent: 2 });
    const calls: string[] = [];

    const result = await schedulePostPaintStartupWork({
      scheduler,
      yieldToPaint: async () => {},
      tasks: [
        {
          id: "storage-maintenance",
          run: () => {
            calls.push("storage");
            throw new Error("database busy");
          },
        },
        {
          id: "download-cleanup-scan",
          run: () => {
            calls.push("cleanup");
          },
        },
      ],
    });

    expect(calls).toEqual(["storage", "cleanup"]);
    expect(result.failed).toEqual([
      { id: "startup.01.storage-maintenance", error: "database busy" },
    ]);
    expect(result.completed).toEqual(["startup.02.download-cleanup-scan"]);
  });

  test("shutdown during the yield prevents SQLite work from starting", async () => {
    let releaseYield!: () => void;
    const yielded = new Promise<void>((resolve) => {
      releaseYield = resolve;
    });
    const scheduler = new BackgroundWorkScheduler({ maxConcurrent: 1 });
    let maintenanceStarted = false;
    let cleanupStarted = false;

    const drain = schedulePostPaintStartupWork({
      scheduler,
      yieldToPaint: () => yielded,
      tasks: [
        {
          id: "storage-maintenance",
          run: () => {
            maintenanceStarted = true;
          },
        },
        {
          id: "download-cleanup-scan",
          run: () => {
            cleanupStarted = true;
          },
        },
      ],
    });
    await Promise.resolve();
    scheduler.beginShutdown("app-exit");
    releaseYield();

    const result = await drain;
    expect(maintenanceStarted).toBe(false);
    expect(cleanupStarted).toBe(false);
    expect(result.skipped).toEqual([{ id: "startup.01.storage-maintenance", reason: "aborted" }]);
  });
});
