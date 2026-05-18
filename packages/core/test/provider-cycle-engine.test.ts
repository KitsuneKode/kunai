import { expect, test } from "bun:test";

import type { ProviderCycleCandidate } from "@kunai/types";

import {
  createProviderCycleFailureError,
  runProviderCycle,
  type ProviderCycleCandidateContext,
} from "../src/index";

const candidates: readonly ProviderCycleCandidate[] = [
  {
    id: "source:kiwi",
    providerId: "allanime",
    sourceId: "sub",
    serverId: "kiwi",
    label: "Sub · Kiwi",
    nativeLabel: "kiwi",
    presentation: "sub",
    priority: 10,
  },
  {
    id: "source:telli",
    providerId: "allanime",
    sourceId: "sub",
    serverId: "telli",
    label: "Sub · Telli",
    nativeLabel: "telli",
    presentation: "sub",
    priority: 20,
  },
];

test("runProviderCycle resolves the first successful provider-local candidate", async () => {
  const result = await runProviderCycle({
    providerId: "allanime",
    candidates,
    now: fixedClock(),
    resolveCandidate: async (candidate) => ({
      streamId: candidate.id,
    }),
  });

  expect(result.selected).toEqual({ streamId: "source:kiwi" });
  expect(result.selectedCandidate?.serverId).toBe("kiwi");
  expect(result.stopReason).toBe("resolved");
  expect(result.attempts).toHaveLength(1);
  expect(result.events.map((event) => event.type)).toEqual(["source:start", "source:success"]);
});

test("runProviderCycle retries a timed out candidate before moving to the next one", async () => {
  const attempts: string[] = [];

  const result = await runProviderCycle({
    providerId: "allanime",
    candidates,
    candidateTimeoutMs: 5,
    retryDelayMs: 0,
    maxAttemptsPerCandidate: 2,
    now: fixedClock(),
    async resolveCandidate(candidate) {
      attempts.push(candidate.id);
      if (candidate.serverId === "kiwi") {
        await Bun.sleep(20);
      }
      return { streamId: candidate.id };
    },
  });

  expect(result.selected).toEqual({ streamId: "source:telli" });
  expect(attempts).toEqual(["source:kiwi", "source:kiwi", "source:telli"]);
  expect(result.attempts.map((attempt) => attempt.failure?.failureClass)).toEqual([
    "candidate-timeout",
    "candidate-timeout",
    undefined,
  ]);
});

test("runProviderCycle moves past non-retryable parse failures", async () => {
  const result = await runProviderCycle({
    providerId: "allanime",
    candidates,
    now: fixedClock(),
    async resolveCandidate(candidate) {
      if (candidate.serverId === "kiwi") {
        throw createProviderCycleFailureError(candidate, {
          failureClass: "candidate-parse",
          message: "Missing stream field",
          retryable: false,
          at: "2026-05-19T00:00:00.000Z",
        });
      }
      return { streamId: candidate.id };
    },
  });

  expect(result.selected).toEqual({ streamId: "source:telli" });
  expect(result.attempts).toHaveLength(2);
  expect(result.attempts[0]?.failure?.failureClass).toBe("candidate-parse");
  expect(result.events.map((event) => event.type)).toContain("source:failed");
});

test("runProviderCycle treats user cancellation as a cancelled cycle without fallback", async () => {
  const controller = new AbortController();

  const result = await runProviderCycle({
    providerId: "allanime",
    candidates,
    signal: controller.signal,
    now: fixedClock(),
    async resolveCandidate(_candidate, context: ProviderCycleCandidateContext) {
      controller.abort("user cancelled");
      context.signal.throwIfAborted();
      return { streamId: "unreachable" };
    },
  });

  expect(result.selected).toBeUndefined();
  expect(result.stopReason).toBe("cancelled");
  expect(result.cancelled).toBe(true);
  expect(result.fallbackRequested).toBe(false);
  expect(result.attempts[0]?.failure?.failureClass).toBe("candidate-user-cancelled");
});

test("runProviderCycle can return an explicit provider fallback signal", async () => {
  const result = await runProviderCycle({
    providerId: "allanime",
    candidates,
    intent: "fallback-provider",
    now: fixedClock(),
    resolveCandidate: async () => ({ streamId: "unreachable" }),
  });

  expect(result.selected).toBeUndefined();
  expect(result.fallbackRequested).toBe(true);
  expect(result.stopReason).toBe("fallback-requested");
  expect(result.attempts).toHaveLength(0);
});

function fixedClock(): () => string {
  return () => "2026-05-19T00:00:00.000Z";
}
