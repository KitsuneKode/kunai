import { describe, expect, jest, test } from "bun:test";

import {
  combineAbortSignals,
  combineAbortSignalsManually,
  createTimeoutSignal,
} from "../src/shared/timeout-signal";

describe("createTimeoutSignal", () => {
  test("arms a deadline when no caller signal is provided", () => {
    jest.useFakeTimers();
    try {
      const signal = createTimeoutSignal(undefined, 20);
      expect(signal.aborted).toBe(false);
      jest.advanceTimersByTime(20);
      expect(signal.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test("keeps the deadline when the caller also passes a signal", () => {
    jest.useFakeTimers();
    try {
      const caller = new AbortController();
      const signal = createTimeoutSignal(caller.signal, 20);
      expect(signal.aborted).toBe(false);
      jest.advanceTimersByTime(20);
      expect(signal.aborted).toBe(true);
      expect(caller.signal.aborted).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test("propagates caller cancellation immediately with its reason", () => {
    const caller = new AbortController();
    const signal = createTimeoutSignal(caller.signal, 60_000);
    const reason = new Error("caller-cancelled");
    caller.abort(reason);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(reason);
  });

  test("starts aborted when the caller signal is already aborted", () => {
    const caller = new AbortController();
    caller.abort();
    expect(createTimeoutSignal(caller.signal, 60_000).aborted).toBe(true);
  });
});

describe("combineAbortSignalsManually", () => {
  test("aborts when any member aborts and propagates its reason", () => {
    const first = new AbortController();
    const second = new AbortController();
    const combined = combineAbortSignalsManually([first.signal, second.signal]);
    expect(combined.aborted).toBe(false);

    const reason = new Error("second-won");
    second.abort(reason);
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe(reason);
  });

  test("starts aborted if any member is already aborted", () => {
    const settled = new AbortController();
    settled.abort(new Error("already-gone"));
    const pending = new AbortController();
    const combined = combineAbortSignalsManually([pending.signal, settled.signal]);
    expect(combined.aborted).toBe(true);
    expect((combined.reason as Error).message).toBe("already-gone");
  });

  test("stays pending while every member is pending", () => {
    jest.useFakeTimers();
    try {
      const controllers = [new AbortController(), new AbortController(), new AbortController()];
      const combined = combineAbortSignalsManually(controllers.map((c) => c.signal));
      jest.advanceTimersByTime(1_000);
      expect(combined.aborted).toBe(false);
      controllers.at(-1)?.abort();
      expect(combined.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("combineAbortSignals", () => {
  test("combines N members so any cancel reaches the result", () => {
    const controllers = [new AbortController(), new AbortController()];
    const combined = combineAbortSignals(controllers.map((c) => c.signal));
    expect(combined.aborted).toBe(false);
    controllers[0]?.abort();
    expect(combined.aborted).toBe(true);
  });
});
