import { expect, test } from "bun:test";

import { waitUntil } from "../../support/wait-until";

test("returns as soon as the predicate holds, without burning the budget", async () => {
  let calls = 0;
  const started = Date.now();
  await waitUntil(() => {
    calls += 1;
    return calls >= 2;
  });
  // A generous ceiling must cost nothing when the condition arrives early.
  expect(Date.now() - started).toBeLessThan(1_000);
});

test("returns immediately when the predicate already holds", async () => {
  const started = Date.now();
  await waitUntil(() => true);
  expect(Date.now() - started).toBeLessThan(100);
});

/**
 * The property the unbounded `while (!cond) await Bun.sleep(1)` loops lacked:
 * they could not fail, only hang until the runner's global timeout, which
 * reports as a timeout rather than as the condition that never held.
 */
test("a condition that never holds fails, and names what was waited for", async () => {
  await expect(waitUntil(() => false, { timeoutMs: 50, label: "outbox drained" })).rejects.toThrow(
    /waitUntil\(outbox drained\) timed out after 50ms/,
  );
});

test("without a label it still reports a timeout rather than hanging", async () => {
  await expect(waitUntil(() => false, { timeoutMs: 50 })).rejects.toThrow(
    /waitUntil timed out after 50ms/,
  );
});

test("a condition that becomes true on the deadline tick is not a failure", async () => {
  // The loop can exit on the deadline in the same tick the condition flips;
  // failing then would be its own flake.
  let ready = false;
  setTimeout(() => {
    ready = true;
  }, 40);
  await waitUntil(() => ready, { timeoutMs: 200, label: "late flip" });
  expect(ready).toBe(true);
});
