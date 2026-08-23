import { describe, expect, test } from "bun:test";

import { createDismissTimerRegistry } from "@/app-shell/dismiss-timer-registry";

function createTimerHarness() {
  const scheduled: Array<{ id: number; callback: () => void; delayMs: number }> = [];
  const cleared: number[] = [];
  return {
    scheduled,
    cleared,
    timers: {
      setTimeout(callback: () => void, delayMs: number) {
        const id = scheduled.length + 1;
        scheduled.push({ id, callback, delayMs });
        return id;
      },
      clearTimeout(handle: unknown) {
        if (typeof handle !== "number") throw new Error("unexpected timer handle");
        cleared.push(handle);
      },
    },
  };
}

describe("dismiss timer registry", () => {
  test("disposal clears every overlapping 6s and 10s dismissal", () => {
    const clock = createTimerHarness();
    const registry = createDismissTimerRegistry(clock.timers);

    registry.schedule(() => {}, 6_000);
    registry.schedule(() => {}, 10_000);
    registry.schedule(() => {}, 6_000);
    registry.dispose();

    expect(clock.scheduled.map(({ id, delayMs }) => ({ id, delayMs }))).toEqual([
      { id: 1, delayMs: 6_000 },
      { id: 2, delayMs: 10_000 },
      { id: 3, delayMs: 6_000 },
    ]);
    expect(clock.cleared).toEqual([1, 2, 3]);
  });

  test("fired dismissals leave no handle for disposal to clear", () => {
    const clock = createTimerHarness();
    const registry = createDismissTimerRegistry(clock.timers);
    let fired = 0;

    registry.schedule(() => {
      fired++;
    }, 6_000);
    registry.schedule(() => {}, 10_000);

    clock.scheduled[0]?.callback();
    registry.dispose();

    expect(fired).toBe(1);
    expect(clock.cleared).toEqual([2]);
  });
});
