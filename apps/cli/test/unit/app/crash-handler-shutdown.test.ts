import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { __testing, runGuardedShutdown, type GuardedShutdownRuntime } from "@/main";

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createRuntime(overrides: Partial<GuardedShutdownRuntime> = {}): {
  runtime: GuardedShutdownRuntime;
  calls: string[];
  exitCodes: number[];
} {
  const calls: string[] = [];
  const exitCodes: number[] = [];
  const runtime: GuardedShutdownRuntime = {
    pauseDownloads: async (reason) => {
      calls.push(`pause:${reason}`);
    },
    shutdownController: async () => {
      calls.push("controller");
    },
    shutdownShell: async () => {
      calls.push("shell");
    },
    disposeContainer: async () => {
      calls.push("container");
    },
    exit: (code) => {
      exitCodes.push(code);
    },
    ...overrides,
  };

  return { runtime, calls, exitCodes };
}

describe("guarded process shutdown", () => {
  beforeEach(() => {
    __testing.resetShutdownGuard();
  });

  afterEach(() => {
    __testing.resetShutdownGuard();
  });

  test("runs the teardown body only once across repeated calls", async () => {
    const { runtime, calls, exitCodes } = createRuntime();

    await runGuardedShutdown({ reason: "uncaught exception", exitCode: 1 }, runtime);
    await runGuardedShutdown({ reason: "unhandled rejection", exitCode: 1 }, runtime);

    expect(calls).toEqual([
      "pause:download paused by uncaught exception",
      "controller",
      "shell",
      "container",
    ]);
    expect(exitCodes).toEqual([1]);
  });

  test("returns a concurrent second call while the first teardown is awaiting", async () => {
    const pause = createDeferred();
    const { runtime, calls, exitCodes } = createRuntime({
      pauseDownloads: async (reason) => {
        calls.push(`pause:${reason}`);
        await pause.promise;
      },
    });

    const firstShutdown = runGuardedShutdown({ reason: "SIGINT", exitCode: 0 }, runtime);
    await Promise.resolve();

    await runGuardedShutdown({ reason: "unhandled rejection", exitCode: 1 }, runtime);
    expect(calls).toEqual(["pause:download paused by SIGINT"]);
    expect(exitCodes).toEqual([]);

    pause.resolve();
    await firstShutdown;

    expect(calls).toEqual(["pause:download paused by SIGINT", "controller", "shell", "container"]);
    expect(exitCodes).toEqual([0]);
  });
});
