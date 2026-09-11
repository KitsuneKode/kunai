import { expect, test } from "bun:test";

import { waitUntil } from "../../support/wait-until";

test("returns after one tick when the predicate becomes ready", async () => {
  let ticks = 0;
  let elapsed = 0;
  await waitUntil(() => ticks === 1, {
    now: () => elapsed,
    tick: async (ms) => {
      expect(ms).toBe(5);
      elapsed += ms;
      ticks += 1;
    },
  });
  expect(ticks).toBe(1);
});

test("does not tick when the predicate already holds", async () => {
  let ticks = 0;
  await waitUntil(() => true, {
    now: () => 0,
    tick: async () => {
      ticks += 1;
    },
  });
  expect(ticks).toBe(0);
});

test.each([
  { label: "outbox drained", message: "waitUntil(outbox drained) timed out after 50ms" },
  { label: undefined, message: "waitUntil timed out after 50ms" },
])("a condition that never holds rejects: $message", async ({ label, message }) => {
  let elapsed = 0;
  let ticks = 0;
  const waiting = waitUntil(() => false, {
    now: () => elapsed,
    timeoutMs: 50,
    label,
    tick: async (ms) => {
      elapsed += ms;
      ticks += 1;
      // A missing clock seam must fail immediately, not spin until real time passes.
      if (ticks > 10) throw new Error("polled past the injected deadline");
    },
  });
  await expect(waiting).rejects.toThrow(message);
  expect(ticks).toBe(10);
});

test("accepts readiness at the deadline without another tick", async () => {
  let elapsed = 0;
  let ready = false;
  let ticks = 0;
  let predicateCalls = 0;
  await waitUntil(
    () => {
      predicateCalls += 1;
      return ready;
    },
    {
      now: () => elapsed,
      timeoutMs: 50,
      tick: async () => {
        ticks += 1;
        elapsed = 50;
        ready = true;
      },
    },
  );
  expect(ticks).toBe(1);
  expect(predicateCalls).toBe(2);
});
