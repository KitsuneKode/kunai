import { describe, expect, jest, test } from "bun:test";

import { withTimeoutSignal } from "@/infra/abort/timeout-signal";

describe("withTimeoutSignal", () => {
  test("aborts when parent signal aborts without AbortSignal.any", async () => {
    const parent = new AbortController();
    const combined = withTimeoutSignal(parent.signal, 60_000);
    parent.abort();
    await nextTurn();
    expect(combined.aborted).toBe(true);
  });

  test("aborts when timeout elapses without AbortSignal.any", () => {
    jest.useFakeTimers();
    try {
      const combined = withTimeoutSignal(undefined, 5);
      expect(combined.aborted).toBe(false);
      jest.advanceTimersByTime(5);
      expect(combined.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
