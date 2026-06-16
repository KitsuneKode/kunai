import { describe, expect, test } from "bun:test";

import { classifyLoopTick, installEventLoopMonitor } from "@/infra/diagnostics/event-loop-monitor";

describe("classifyLoopTick", () => {
  test("an on-time tick is not a stall", () => {
    const r = classifyLoopTick({
      scheduledAt: 1000,
      firedAt: 1052,
      intervalMs: 50,
      cpuMicros: 1000,
      thresholdMs: 60,
    });
    expect(r.lagMs).toBe(2);
    expect(r.isStall).toBe(false);
  });

  test("a late tick over threshold is a stall", () => {
    const r = classifyLoopTick({
      scheduledAt: 1000,
      firedAt: 1300, // 300ms after schedule, interval 50 → 250ms lag
      intervalMs: 50,
      cpuMicros: 180_000, // 180ms CPU across the gap
      thresholdMs: 60,
    });
    expect(r.lagMs).toBe(250);
    expect(r.isStall).toBe(true);
    expect(r.kind).toBe("busy"); // cpu (180) >= lag/2 (125)
  });

  test("a stall with little CPU is classified as waiting", () => {
    const r = classifyLoopTick({
      scheduledAt: 0,
      firedAt: 300,
      intervalMs: 50,
      cpuMicros: 10_000, // 10ms CPU over a 250ms lag → idle/blocked-syscall
      thresholdMs: 60,
    });
    expect(r.lagMs).toBe(250);
    expect(r.kind).toBe("waiting");
  });

  test("never reports negative lag", () => {
    const r = classifyLoopTick({
      scheduledAt: 1000,
      firedAt: 1040, // fired early
      intervalMs: 50,
      cpuMicros: 0,
      thresholdMs: 60,
    });
    expect(r.lagMs).toBe(0);
  });
});

describe("installEventLoopMonitor", () => {
  test("is a no-op (returns a stop fn) when the env flag is unset", () => {
    const stop = installEventLoopMonitor({});
    expect(typeof stop).toBe("function");
    stop(); // must not throw
  });
});
