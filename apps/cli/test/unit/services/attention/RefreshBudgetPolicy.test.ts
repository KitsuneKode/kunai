import { expect, test } from "bun:test";

import { shouldRefreshAttentionItem } from "@/services/attention/RefreshBudgetPolicy";

test("visible followed items within budget can refresh", () => {
  expect(
    shouldRefreshAttentionItem({
      visible: true,
      followed: true,
      muted: false,
      checksUsed: 2,
      maxChecks: 5,
      lastCheckedAt: "2026-05-16T00:00:00.000Z",
      now: "2026-05-17T00:00:00.000Z",
      minIntervalMs: 60_000,
    }),
  ).toEqual({ refresh: true, reason: "eligible" });
});

test("budget and muted state prevent refresh", () => {
  expect(
    shouldRefreshAttentionItem({
      visible: true,
      followed: true,
      muted: true,
      checksUsed: 0,
      maxChecks: 5,
      now: "2026-05-17T00:00:00.000Z",
      minIntervalMs: 60_000,
    }),
  ).toEqual({ refresh: false, reason: "muted" });

  expect(
    shouldRefreshAttentionItem({
      visible: true,
      followed: true,
      muted: false,
      checksUsed: 5,
      maxChecks: 5,
      now: "2026-05-17T00:00:00.000Z",
      minIntervalMs: 60_000,
    }),
  ).toEqual({ refresh: false, reason: "budget-exhausted" });
});
