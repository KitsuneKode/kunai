import { expect, test } from "bun:test";

import { AttentionRefreshWorker } from "@/services/attention/AttentionRefreshWorker";

const candidates = [
  { id: "visible-followed", visible: true, followed: true, muted: false },
  { id: "hidden-followed", visible: false, followed: true, muted: false },
];

test("worker is inert when provider availability sync is disabled", async () => {
  const calls: string[] = [];
  const worker = new AttentionRefreshWorker({
    flags: { providerAvailabilitySync: false },
    refreshAvailability: async (id) => {
      calls.push(id);
    },
  });

  const result = await worker.runOnce({
    candidates,
    maxChecks: 2,
    now: "2026-05-17T00:00:00.000Z",
    minIntervalMs: 60_000,
  });

  expect(result.status).toBe("disabled");
  expect(calls).toEqual([]);
});

test("worker plans eligible ids without network work unless a refresh callback exists", async () => {
  const worker = new AttentionRefreshWorker({
    flags: { providerAvailabilitySync: true },
  });

  const result = await worker.runOnce({
    candidates,
    maxChecks: 2,
    now: "2026-05-17T00:00:00.000Z",
    minIntervalMs: 60_000,
  });

  expect(result).toMatchObject({
    status: "planned-only",
    refreshIds: ["visible-followed"],
    refreshedIds: [],
  });
});

test("worker isolates provider refresh failures per title", async () => {
  const worker = new AttentionRefreshWorker({
    flags: { providerAvailabilitySync: true },
    refreshAvailability: async (id) => {
      if (id === "visible-followed") throw new Error("provider timed out");
    },
  });

  const result = await worker.runOnce({
    candidates,
    maxChecks: 2,
    now: "2026-05-17T00:00:00.000Z",
    minIntervalMs: 60_000,
  });

  expect(result.status).toBe("completed");
  expect(result.failed).toEqual([{ id: "visible-followed", error: "Error: provider timed out" }]);
});

test("worker passes cancellation into provider refresh and stops after abort", async () => {
  const controller = new AbortController();
  const calls: string[] = [];
  const worker = new AttentionRefreshWorker({
    flags: { providerAvailabilitySync: true },
    refreshAvailability: async (id, signal) => {
      calls.push(`${id}:${signal.aborted}`);
      controller.abort();
    },
  });

  const result = await worker.runOnce({
    candidates: [
      { id: "first", visible: true, followed: true, muted: false },
      { id: "second", visible: true, followed: true, muted: false },
    ],
    maxChecks: 2,
    now: "2026-05-17T00:00:00.000Z",
    minIntervalMs: 60_000,
    signal: controller.signal,
  });

  expect(result.status).toBe("aborted");
  expect(calls).toEqual(["first:false"]);
});

test("worker records budget telemetry and executes only planned ids", async () => {
  const diagnostics: string[] = [];
  const calls: string[] = [];
  const worker = new AttentionRefreshWorker({
    flags: { providerAvailabilitySync: true },
    diagnostics: {
      record: (event) => diagnostics.push(`${event.message}:${event.context?.refreshCount}`),
    },
    refreshAvailability: async (id) => {
      calls.push(id);
    },
  });

  const result = await worker.runOnce({
    candidates: [
      { id: "first", visible: true, followed: true, muted: false },
      { id: "second", visible: true, followed: true, muted: false },
      { id: "third", visible: true, followed: true, muted: false },
    ],
    maxChecks: 2,
    now: "2026-05-17T00:00:00.000Z",
    minIntervalMs: 60_000,
  });

  expect(result.refreshIds).toEqual(["first", "second"]);
  expect(calls).toEqual(["first", "second"]);
  expect(diagnostics).toContain("Attention refresh planned:2");
  expect(diagnostics).toContain("Attention refresh completed:2");
});
