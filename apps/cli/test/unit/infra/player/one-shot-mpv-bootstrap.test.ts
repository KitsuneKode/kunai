import { describe, expect, test } from "bun:test";

import type { MpvChildProcess, MpvTerminationResult } from "@/infra/player/mpv-process-registry";
import { assertOneShotMpvIpcEndpointReady, settleOneShotMpvIpcBootstrapFailure } from "@/mpv";

const child = {
  exited: Promise.resolve(0),
  exitCode: 0,
  kill: () => {},
} satisfies MpvChildProcess;

describe("one-shot mpv IPC bootstrap ownership", () => {
  test("an endpoint timeout is a bootstrap failure, not player readiness", () => {
    expect(() => assertOneShotMpvIpcEndpointReady(false, "endpoint timed out")).toThrow(
      "endpoint timed out",
    );
    expect(() => assertOneShotMpvIpcEndpointReady(true, "unused")).not.toThrow();
  });

  test("waits for owned-child termination before clearing its control", async () => {
    let releaseTermination!: () => void;
    const terminationGate = new Promise<void>((resolve) => {
      releaseTermination = resolve;
    });
    const events: string[] = [];

    const settlement = settleOneShotMpvIpcBootstrapFailure({
      process: child,
      terminate: async (target): Promise<MpvTerminationResult> => {
        expect(target).toBe(child);
        events.push("terminate-started");
        await terminationGate;
        events.push("terminated");
        return { exited: true, exitCode: 0, signal: "SIGTERM" };
      },
      clearOwnedControl: () => events.push("control-cleared"),
      reportTerminationFailure: () => events.push("termination-failed"),
    });

    await Promise.resolve();
    expect(events).toEqual(["terminate-started"]);

    releaseTermination();
    await expect(settlement).resolves.toEqual({ exited: true, exitCode: 0, signal: "SIGTERM" });
    expect(events).toEqual(["terminate-started", "terminated", "control-cleared"]);
  });

  test("keeps ownership when the child cannot be reaped", async () => {
    const events: string[] = [];

    await expect(
      settleOneShotMpvIpcBootstrapFailure({
        process: child,
        terminate: async () => ({ exited: false, exitCode: null, signal: "SIGKILL" }),
        clearOwnedControl: () => events.push("control-cleared"),
        reportTerminationFailure: () => events.push("termination-failed"),
      }),
    ).resolves.toEqual({ exited: false, exitCode: null, signal: "SIGKILL" });

    expect(events).toEqual(["termination-failed"]);
  });
});
