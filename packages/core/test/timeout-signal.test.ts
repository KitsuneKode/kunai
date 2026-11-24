import { describe, expect, test } from "bun:test";

import {
  combineAbortSignals,
  combineAbortSignalsManually,
  createDeadlineSignal,
  createTimeoutSignal,
  type TimeoutTimers,
} from "../src/timeout-signal";

function createFakeTimers() {
  let nextId = 1;
  const active = new Map<number, { readonly callback: () => void; readonly ms: number }>();
  const cleared: number[] = [];

  const timers: TimeoutTimers<number> = {
    setTimeout(callback, ms) {
      const id = nextId++;
      active.set(id, { callback, ms });
      return id;
    },
    clearTimeout(handle) {
      cleared.push(handle);
      active.delete(handle);
    },
  };

  return {
    timers,
    active,
    cleared,
    fireAll() {
      const pending = Array.from(active.entries());
      active.clear();
      for (const [, entry] of pending) {
        entry.callback();
      }
    },
  };
}

describe("createDeadlineSignal", () => {
  test("aborts with TimeoutError DOMException when deadline fires", () => {
    const fake = createFakeTimers();
    const deadline = createDeadlineSignal(undefined, 250, { timers: fake.timers });
    expect(deadline.signal.aborted).toBe(false);
    expect(deadline.timedOut()).toBe(false);
    expect(fake.active.size).toBe(1);

    fake.fireAll();
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.timedOut()).toBe(true);
    const reason = deadline.signal.reason;
    expect(reason).toBeInstanceOf(DOMException);
    if (reason instanceof DOMException) {
      expect(reason.name).toBe("TimeoutError");
    }
  });

  test("preserves a custom timeout reason", () => {
    const fake = createFakeTimers();
    const deadline = createDeadlineSignal(undefined, 500, {
      reason: "relay upstream timeout",
      timers: fake.timers,
    });
    fake.fireAll();
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.timedOut()).toBe(true);
    expect(deadline.signal.reason).toBe("relay upstream timeout");
  });

  test("clears the timer on release() and ignores subsequent release calls", () => {
    const fake = createFakeTimers();
    const deadline = createDeadlineSignal(undefined, 1_000, { timers: fake.timers });
    expect(fake.active.size).toBe(1);

    deadline.release();
    expect(fake.active.size).toBe(0);
    expect(fake.cleared).toHaveLength(1);
    expect(deadline.signal.aborted).toBe(false);

    deadline.release();
    expect(fake.cleared).toHaveLength(1);
  });

  test("propagates caller abort reason immediately and clears the timer", () => {
    const fake = createFakeTimers();
    const caller = new AbortController();
    const deadline = createDeadlineSignal(caller.signal, 10_000, { timers: fake.timers });
    const reason = new Error("user-cancelled");

    caller.abort(reason);
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.signal.reason).toBe(reason);
    expect(deadline.timedOut()).toBe(false);
    expect(fake.active.size).toBe(0);
    expect(fake.cleared).toHaveLength(1);
  });

  test("starts aborted without arming a timer when caller is already aborted", () => {
    const fake = createFakeTimers();
    const caller = new AbortController();
    const reason = new Error("already-aborted");
    caller.abort(reason);

    const deadline = createDeadlineSignal(caller.signal, 5_000, { timers: fake.timers });
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.signal.reason).toBe(reason);
    expect(deadline.timedOut()).toBe(false);
    expect(fake.active.size).toBe(0);
    deadline.release();
  });

  test("detaches parent abort listener on release()", () => {
    const fake = createFakeTimers();
    const caller = new AbortController();
    const deadline = createDeadlineSignal(caller.signal, 5_000, { timers: fake.timers });

    deadline.release();
    caller.abort(new Error("late-abort"));
    expect(deadline.signal.aborted).toBe(false);
  });
});

describe("createTimeoutSignal and combineAbortSignals", () => {
  test("preserves caller reason when caller aborts before deadline", () => {
    const caller = new AbortController();
    const signal = createTimeoutSignal(caller.signal, 60_000);
    const reason = new Error("caller-cancelled");
    caller.abort(reason);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(reason);
  });

  test("preserves caller reason immediately when caller is already aborted", () => {
    const caller = new AbortController();
    const reason = new Error("pre-aborted");
    caller.abort(reason);
    const signal = createTimeoutSignal(caller.signal, 60_000);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(reason);
  });

  test("combineAbortSignalsManually forwards winning reason and detaches sibling listeners", () => {
    const first = new AbortController();
    const second = new AbortController();
    const combined = combineAbortSignalsManually([first.signal, second.signal]);
    const reason = new Error("second-won");

    second.abort(reason);
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe(reason);

    // Subsequent abort on the first signal does not alter the reason.
    first.abort(new Error("first-late"));
    expect(combined.reason).toBe(reason);
  });

  test("combineAbortSignals propagates any member abort reason", () => {
    const a = new AbortController();
    const b = new AbortController();
    const combined = combineAbortSignals([a.signal, b.signal]);
    const reason = new Error("a-won");
    a.abort(reason);
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe(reason);
  });
});
