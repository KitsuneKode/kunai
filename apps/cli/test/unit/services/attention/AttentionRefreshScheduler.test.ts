import { expect, test } from "bun:test";

import { planAttentionRefresh } from "@/services/attention/AttentionRefreshScheduler";

test("plans visible followed items first within budget", () => {
  const plan = planAttentionRefresh({
    maxChecks: 2,
    now: "2026-05-17T00:00:00.000Z",
    minIntervalMs: 60_000,
    items: [
      { id: "hidden-followed", visible: false, followed: true, muted: false },
      { id: "visible-implicit", visible: true, followed: false, muted: false },
      { id: "visible-followed-1", visible: true, followed: true, muted: false },
      { id: "visible-followed-2", visible: true, followed: true, muted: false },
      { id: "visible-followed-3", visible: true, followed: true, muted: false },
    ],
  });

  expect(plan.refreshIds).toEqual(["visible-followed-1", "visible-followed-2"]);
  expect(plan.skipped.find((item) => item.id === "visible-followed-3")?.reason).toBe(
    "budget-exhausted",
  );
});

test("respects muted and recently checked items", () => {
  const plan = planAttentionRefresh({
    maxChecks: 5,
    now: "2026-05-17T00:00:00.000Z",
    minIntervalMs: 60_000,
    items: [
      { id: "muted", visible: true, followed: true, muted: true },
      {
        id: "fresh",
        visible: true,
        followed: true,
        muted: false,
        lastCheckedAt: "2026-05-16T23:59:30.000Z",
      },
    ],
  });

  expect(plan.refreshIds).toEqual([]);
  expect(plan.skipped.map((item) => item.reason)).toEqual(["muted", "too-soon"]);
});
