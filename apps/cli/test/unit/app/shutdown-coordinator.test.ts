import { expect, test } from "bun:test";

import {
  createShutdownCoordinator,
  type ShutdownIntent,
  type ShutdownPhase,
  type ShutdownRuntime,
} from "@/app/session/shutdown-coordinator";

type Deferred = { promise: Promise<void>; resolve: () => void };

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function recordingRuntime(
  calls: string[],
  overrides: Partial<ShutdownRuntime> = {},
): ShutdownRuntime {
  return {
    quiesce: async (intent) => void calls.push(`quiesce:${intent.reason}`),
    restoreTerminal: async (intent) => void calls.push(`terminal:${intent.reason}`),
    preserveCriticalState: async (intent) => void calls.push(`preserve:${intent.reason}`),
    releaseExternalResources: async (intent) => void calls.push(`release:${intent.reason}`),
    dispose: async (intent) => void calls.push(`dispose:${intent.reason}`),
    recordFailure: (phase, _error) => void calls.push(`failure:${phase}`),
    unrefStdin: () => void calls.push("stdin:unref"),
    exit: (code) => void calls.push(`exit:${code}`),
    ...overrides,
  };
}

test("runs every phase in order and exits with the intent code", async () => {
  const calls: string[] = [];
  const coordinator = createShutdownCoordinator(recordingRuntime(calls));

  await coordinator.request({ reason: "SIGINT", exitCode: 130 });

  expect(calls).toEqual([
    "quiesce:SIGINT",
    "terminal:SIGINT",
    "preserve:SIGINT",
    "release:SIGINT",
    "dispose:SIGINT",
    "stdin:unref",
    "exit:130",
  ]);
});

test("keeps a single in-flight sequence across concurrent requests", async () => {
  const calls: string[] = [];
  const gate = deferred();
  const coordinator = createShutdownCoordinator(
    recordingRuntime(calls, {
      quiesce: async () => {
        calls.push("quiesce");
        await gate.promise;
      },
    }),
  );

  const first = coordinator.request({ reason: "normal exit", exitCode: 0 });
  const second = coordinator.request({ reason: "normal exit", exitCode: 0 });
  expect(coordinator.isShuttingDown()).toBe(true);
  gate.resolve();
  await Promise.all([first, second]);

  expect(calls.filter((call) => call === "quiesce")).toHaveLength(1);
  expect(calls.filter((call) => call.startsWith("exit:"))).toEqual(["exit:0"]);
});

test("a later fatal request upgrades the exit code of the in-flight sequence", async () => {
  const calls: string[] = [];
  const gate = deferred();
  const coordinator = createShutdownCoordinator(
    recordingRuntime(calls, {
      preserveCriticalState: async () => {
        calls.push("preserve");
        await gate.promise;
      },
    }),
  );

  const first = coordinator.request({ reason: "normal exit", exitCode: 0 });
  const second = coordinator.request({ reason: "fatal error", exitCode: 1, fatal: true });
  gate.resolve();
  await Promise.all([first, second]);

  expect(calls.filter((call) => call.startsWith("exit:"))).toEqual(["exit:1"]);
});

test("a phase failure is recorded and later phases still run", async () => {
  const calls: string[] = [];
  const failures: ShutdownPhase[] = [];
  const boom = new Error("terminal restore failed");
  const coordinator = createShutdownCoordinator(
    recordingRuntime(calls, {
      restoreTerminal: async () => {
        throw boom;
      },
      recordFailure: (phase, error) => {
        failures.push(phase);
        expect(error).toBe(boom);
      },
    }),
  );

  await coordinator.request({ reason: "SIGTERM", exitCode: 143 });

  expect(failures).toEqual(["restore-terminal"]);
  expect(calls).toEqual([
    "quiesce:SIGTERM",
    "preserve:SIGTERM",
    "release:SIGTERM",
    "dispose:SIGTERM",
    "stdin:unref",
    "exit:143",
  ]);
});

test("the force deadline aborts a hung release phase and still exits", async () => {
  const calls: string[] = [];
  let releaseSignal: AbortSignal | undefined;
  const exited = deferred();
  const coordinator = createShutdownCoordinator(
    recordingRuntime(calls, {
      releaseExternalResources: async (_intent: ShutdownIntent, signal: AbortSignal) => {
        releaseSignal = signal;
        calls.push("release:hung");
        await new Promise<void>(() => {});
      },
      exit: (code) => {
        calls.push(`exit:${code}`);
        exited.resolve();
      },
    }),
    { deadlineMs: 20 },
  );

  void coordinator.request({ reason: "SIGINT", exitCode: 130 });
  await exited.promise;

  expect(releaseSignal?.aborted).toBe(true);
  expect(calls).toContain("stdin:unref");
  expect(calls.filter((call) => call.startsWith("exit:"))).toEqual(["exit:130"]);
});
