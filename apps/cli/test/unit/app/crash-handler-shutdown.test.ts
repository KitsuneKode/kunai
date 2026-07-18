import { describe, expect, test } from "bun:test";

import { createShutdownCoordinator } from "@/app/session/shutdown-coordinator";
import { createMainShutdownRuntime, type MainShutdownDeps } from "@/main";

function createDeps(calls: string[], exitCodes: number[]): MainShutdownDeps {
  const container = {
    downloadService: {
      beginShutdown: () => calls.push("downloads:begin"),
      pauseActiveJobsForShutdown: async () => void calls.push("downloads:pause"),
    },
    backgroundWorkScheduler: {
      beginShutdown: () => calls.push("scheduler:begin"),
    },
    binaryAutoUpdater: {
      stopBackground: () => calls.push("updater:stop"),
    },
    activePlaybackCheckpoint: {
      flush: () => calls.push("playback:checkpoint"),
    },
    config: {
      flushPending: async () => void calls.push("config:flush"),
    },
    queueService: {
      prepareForShutdown: () => {
        calls.push("queue:prepare");
        return "closed" as const;
      },
    },
    diagnosticsService: {
      flush: () => calls.push("diagnostics:flush"),
      record: () => {},
    },
  };
  return {
    getController: () =>
      ({
        beginShutdown: () => calls.push("controller:begin"),
        releaseExternalResources: async () => void calls.push("controller:release"),
      }) as never,
    getContainer: () => container as never,
    shutdownShell: async () => void calls.push("shell:restore"),
    awaitLifetimeLock: async () => void calls.push("lock:awaited"),
    releaseVersionLock: async () => void calls.push("lock:release"),
    disposeContainer: async () => void calls.push("dispose"),
    exit: (code) => void exitCodes.push(code),
  };
}

describe("main shutdown runtime", () => {
  test("runs quiescence, terminal restore, preservation, release, disposal in order", async () => {
    const calls: string[] = [];
    const exitCodes: number[] = [];
    const coordinator = createShutdownCoordinator(
      createMainShutdownRuntime(createDeps(calls, exitCodes)),
    );

    await coordinator.request({ reason: "SIGTERM", exitCode: 143 });

    // Quiescence closes admission before the terminal is restored, critical
    // state is preserved before any external resource is released, and
    // disposal (SQLite close) is last.
    expect(calls).toEqual([
      "controller:begin",
      "downloads:begin",
      "scheduler:begin",
      "updater:stop",
      "shell:restore",
      // The preservation batch runs concurrently; its internal order follows
      // microtask scheduling, but every entry lands before any release below.
      "config:flush",
      "downloads:pause",
      "playback:checkpoint",
      "queue:prepare",
      "diagnostics:flush",
      "controller:release",
      "lock:awaited",
      "lock:release",
      "dispose",
    ]);
    expect(exitCodes).toEqual([143]);
  });

  test("repeated requests share one cleanup and a fatal request upgrades the exit code", async () => {
    const calls: string[] = [];
    const exitCodes: number[] = [];
    const coordinator = createShutdownCoordinator(
      createMainShutdownRuntime(createDeps(calls, exitCodes)),
    );

    const first = coordinator.request({ reason: "normal exit", exitCode: 0 });
    const second = coordinator.request({ reason: "unhandled rejection", exitCode: 1, fatal: true });
    await Promise.all([first, second]);

    expect(calls.filter((call) => call === "dispose")).toHaveLength(1);
    expect(exitCodes).toEqual([1]);
  });

  test("a failing preservation phase still releases resources and disposes", async () => {
    const calls: string[] = [];
    const exitCodes: number[] = [];
    const deps = createDeps(calls, exitCodes);
    const failingDeps: MainShutdownDeps = {
      ...deps,
      shutdownShell: async () => {
        throw new Error("ink already unmounted");
      },
    };
    const coordinator = createShutdownCoordinator(createMainShutdownRuntime(failingDeps));

    await coordinator.request({ reason: "SIGINT", exitCode: 130 });

    expect(calls).toContain("downloads:pause");
    expect(calls).toContain("controller:release");
    expect(calls).toContain("dispose");
    expect(exitCodes).toEqual([130]);
  });
});
