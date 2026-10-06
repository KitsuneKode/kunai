import { describe, expect, test } from "bun:test";

import type { ProviderCycleCandidate } from "@kunai/types";
import { ProviderHttpError } from "@kunai/types";

import {
  classifyEndpointFailureFromCycleFailure,
  classifyProviderCycleError,
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

test("allowTransientCandidateRetry grants an attempt beyond the normal budget", async () => {
  const attempts: string[] = [];

  const result = await runProviderCycle({
    providerId: "allanime",
    candidates: [candidates[0]!],
    candidateTimeoutMs: 5,
    retryDelayMs: 0,
    maxAttemptsPerCandidate: 2,
    allowTransientCandidateRetry: true,
    now: fixedClock(),
    async resolveCandidate(candidate) {
      attempts.push(candidate.id);
      await Bun.sleep(20);
      return { streamId: candidate.id };
    },
  });

  // 2 budgeted attempts + 1 transient retry. The flag previously consumed part
  // of the budget instead of extending it, so it never granted anything.
  expect(attempts).toHaveLength(3);
  expect(result.stopReason).toBe("exhausted");
  expect(
    result.events.filter(
      (event) =>
        event.type === "retry:scheduled" && event.attributes?.reason === "transient-endpoint",
    ),
  ).toHaveLength(1);
});

test("allowTransientCandidateRetry is not spent on non-transient failures", async () => {
  const attempts: string[] = [];

  await runProviderCycle({
    providerId: "allanime",
    candidates: [candidates[0]!],
    retryDelayMs: 0,
    maxAttemptsPerCandidate: 2,
    allowTransientCandidateRetry: true,
    now: fixedClock(),
    async resolveCandidate(candidate) {
      attempts.push(candidate.id);
      throw createProviderCycleFailureError(candidate, {
        failureClass: "candidate-parse",
        message: "Missing stream field",
        retryable: false,
        at: "2026-05-19T00:00:00.000Z",
      });
    },
  });

  expect(attempts).toHaveLength(1);
});

test("transient retries wait by default instead of re-firing instantly", async () => {
  const startedAt: number[] = [];

  await runProviderCycle({
    providerId: "allanime",
    candidates: [candidates[0]!],
    candidateTimeoutMs: 5,
    maxAttemptsPerCandidate: 2,
    now: fixedClock(),
    async resolveCandidate(candidate) {
      startedAt.push(Date.now());
      await Bun.sleep(20);
      return { streamId: candidate.id };
    },
  });

  expect(startedAt).toHaveLength(2);
  // No explicit retryDelayMs, so the transient default applies — retrying a
  // timeout with zero delay only reproduces the timeout.
  expect(startedAt[1]! - startedAt[0]!).toBeGreaterThanOrEqual(700);
});

test("runProviderCycle streams source events to an external observer", async () => {
  const observed: string[] = [];
  await runProviderCycle({
    providerId: "allanime",
    candidates: [candidates[0]!],
    maxAttemptsPerCandidate: 1,
    now: fixedClock(),
    emit: (event) => observed.push(`${event.type}:${event.sourceId ?? "none"}`),
    async resolveCandidate(candidate) {
      throw createProviderCycleFailureError(candidate, {
        failureClass: "candidate-parse",
        message: "Missing stream field",
        retryable: false,
        at: "2026-05-19T00:00:00.000Z",
      });
    },
  });

  expect(observed).toEqual(["source:start:sub", "source:failed:sub"]);
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

test("runProviderCycle supports provider-local terminal failure policies", async () => {
  const attempted: string[] = [];
  const result = await runProviderCycle({
    providerId: "allanime",
    candidates,
    maxAttemptsPerCandidate: 1,
    now: fixedClock(),
    shouldStopAfterFailure: (failure) => failure.failureClass === "candidate-blocked",
    resolveCandidate: async (selected) => {
      attempted.push(selected.id);
      throw createProviderCycleFailureError(selected, {
        failureClass: "candidate-blocked",
        message: "provider-wide session missing",
        retryable: false,
        at: "2026-05-19T00:00:00.000Z",
      });
    },
  });

  expect(result.stopReason).toBe("exhausted");
  expect(attempted).toEqual(["source:kiwi"]);
  expect(result.attempts).toHaveLength(1);
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

test("runProviderCycle does not retry network-offline failures inside the same request", async () => {
  const attempts: string[] = [];

  const result = await runProviderCycle({
    providerId: "allanime",
    candidates,
    maxAttemptsPerCandidate: 3,
    now: fixedClock(),
    async resolveCandidate(candidate) {
      attempts.push(candidate.id);
      throw new Error("getaddrinfo ENOTFOUND api.allanime.day");
    },
  });

  expect(result.selected).toBeUndefined();
  // Offline evidence corroborates across distinct servers: both candidates
  // must fail DNS-level before the walk calls the uplink dead.
  expect(attempts).toEqual(["source:kiwi", "source:telli"]);
  expect(result.stopReason).toBe("network-offline");
  expect(result.attempts.map((attempt) => attempt.failure?.failureClass)).toEqual([
    "candidate-network",
    "candidate-network",
  ]);
  expect(result.attempts.every((attempt) => attempt.failure?.retryable === false)).toBe(true);
});

test("runProviderCycle keeps cycling past a single dead domain to a live sibling server", async () => {
  const attempts: string[] = [];

  const result = await runProviderCycle({
    providerId: "allanime",
    candidates,
    maxAttemptsPerCandidate: 3,
    now: fixedClock(),
    async resolveCandidate(candidate) {
      attempts.push(candidate.id);
      if (candidate.serverId === "kiwi") {
        throw new Error("getaddrinfo ENOTFOUND dead.example.invalid");
      }
      return { streamId: candidate.id };
    },
  });

  // One provider-internal domain being unreachable is a dead-mirror signal,
  // not a dead uplink — the next server must still get its attempt.
  expect(result.selected).toEqual({ streamId: "source:telli" });
  expect(attempts).toEqual(["source:kiwi", "source:telli"]);
  expect(result.stopReason).toBe("resolved");
});

test("runProviderCycle retries an offline-classified failure on the same server only once per verdict", async () => {
  const attempts: string[] = [];

  const result = await runProviderCycle({
    providerId: "allanime",
    candidates: [candidates[0]!],
    maxAttemptsPerCandidate: 3,
    now: fixedClock(),
    async resolveCandidate(candidate) {
      attempts.push(candidate.id);
      throw new Error("getaddrinfo ENOTFOUND api.allanime.day");
    },
  });

  // A single dead domain never reaches quorum: the walk ends exhausted on
  // that server's failure rather than claiming the uplink is down.
  expect(result.selected).toBeUndefined();
  expect(attempts).toEqual(["source:kiwi"]);
  expect(result.stopReason).toBe("exhausted");
});

test("classifyProviderCycleError keeps blocked and parse failures non-retryable", () => {
  expect(classifyProviderCycleError(new Error("HTTP 403 blocked"))).toMatchObject({
    failureClass: "candidate-blocked",
    retryable: false,
  });
  expect(classifyProviderCycleError(new Error("parse failed: missing sources"))).toMatchObject({
    failureClass: "candidate-parse",
    retryable: false,
  });
  expect(classifyProviderCycleError(new Error("temporary fetch failed"))).toMatchObject({
    failureClass: "candidate-network",
    retryable: true,
  });
});

// #458: a status-bearing ProviderHttpError classifies on the status, not on
// what the message happens to contain — a 429/503 used to degrade to a
// retryable "candidate-unknown" and never reached the quarantine gate.
test("classifyProviderCycleError reads ProviderHttpError structurally", () => {
  expect(
    classifyProviderCycleError(
      new ProviderHttpError({
        message: "RGShows API returned HTTP 429",
        status: 429,
        code: "rate-limited",
        retryable: true,
      }),
    ),
  ).toMatchObject({ failureClass: "candidate-rate-limited", retryable: true });

  expect(
    classifyProviderCycleError(
      new ProviderHttpError({
        message: "VidRock API returned HTTP 503",
        status: 503,
        code: "provider-unavailable",
        retryable: true,
      }),
    ),
  ).toMatchObject({ failureClass: "candidate-server-error", retryable: true });

  expect(
    classifyProviderCycleError(
      new ProviderHttpError({
        message: "upstream answered 403 without naming cloudflare",
        status: 403,
        code: "blocked",
        retryable: false,
      }),
    ),
  ).toMatchObject({ failureClass: "candidate-blocked", retryable: false });
});

test("endpoint health sees rate-limited and server-error cycle failures", () => {
  const base = {
    providerId: "vidrock",
    candidateId: "source:vidrock",
    message: "failed",
    retryable: true,
    at: "2026-05-19T00:00:00.000Z",
  } as const;

  expect(
    classifyEndpointFailureFromCycleFailure({ ...base, failureClass: "candidate-rate-limited" }),
  ).toBe("server-error");
  expect(
    classifyEndpointFailureFromCycleFailure({ ...base, failureClass: "candidate-server-error" }),
  ).toBe("server-error");
});

test("endpoint health learns from parse failures but not ambiguous provider blocks", () => {
  const base = {
    providerId: "allanime",
    candidateId: "source:kiwi",
    message: "failed",
    retryable: false,
    at: "2026-05-19T00:00:00.000Z",
  } as const;

  expect(
    classifyEndpointFailureFromCycleFailure({ ...base, failureClass: "candidate-parse" }),
  ).toBe("server-error");
  expect(
    classifyEndpointFailureFromCycleFailure({ ...base, failureClass: "candidate-blocked" }),
  ).toBeNull();
  expect(
    classifyEndpointFailureFromCycleFailure({ ...base, failureClass: "candidate-empty" }),
  ).toBeNull();
});

test("provider-wide blocked evidence does not poison endpoint health", async () => {
  const endpointFailures: string[] = [];
  const candidate = candidates[0];
  if (!candidate) throw new Error("missing provider-cycle fixture");

  await runProviderCycle({
    providerId: "allanime",
    candidates: [candidate],
    maxAttemptsPerCandidate: 1,
    endpointHealth: {
      shouldTry: () => true,
      recordSuccess: () => {},
      recordFailure: (_providerId, _endpoint, info) => endpointFailures.push(info.class),
    },
    now: fixedClock(),
    async resolveCandidate(selected) {
      throw createProviderCycleFailureError(selected, {
        failureClass: "candidate-blocked",
        message: "Provider session guard rejected this request",
        retryable: false,
        at: "2026-05-19T00:00:00.000Z",
      });
    },
  });

  expect(endpointFailures).toEqual([]);
});

function fixedClock(): () => string {
  return () => "2026-05-19T00:00:00.000Z";
}

describe("hostile candidate rejections", () => {
  test("a candidate rejecting with a non-Error value is classified, not a crash", async () => {
    const result = await runProviderCycle({
      providerId: "movy",
      candidates: [
        { id: "a", providerId: "movy", serverId: "denver", priority: 0 },
        { id: "b", providerId: "movy", serverId: "atlanta", priority: 1 },
      ],
      resolveCandidate: async (candidate) => {
        if (candidate.serverId === "denver") throw "lane exploded as a string";
        return { ok: true };
      },
    });
    expect(result.stopReason).toBe("resolved");
    expect(result.attempts[0]?.failure).toBeDefined();
  });

  test("a candidate rejecting with null still produces a failure record", async () => {
    const result = await runProviderCycle({
      providerId: "movy",
      candidates: [{ id: "a", providerId: "movy", serverId: "denver", priority: 0 }],
      resolveCandidate: async () => {
        throw null;
      },
    });
    expect(result.stopReason).not.toBe("resolved");
    expect(result.attempts.length).toBeGreaterThan(0);
    expect(result.attempts.every((attempt) => attempt.failure)).toBe(true);
  });
});
