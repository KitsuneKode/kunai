import { describe, expect, test } from "bun:test";

import type {
  ProviderCycleCandidate,
  ProviderCycleFailure,
  ProviderResolveInput,
  ProviderRuntimeContext,
} from "@kunai/types";

import {
  cycleExhaustedResult,
  cycleFailureClassFromProviderCode,
  providerFailureCodeFromCycleFailure,
} from "../src/shared/provider-cycle";

const NOW = "2026-01-01T00:00:00.000Z";

const context: ProviderRuntimeContext = {
  now: () => NOW,
};

const input: ProviderResolveInput = {
  title: { id: "frieren", kind: "anime", title: "Frieren" },
  episode: { episode: 1 },
  mediaKind: "anime",
  intent: "play",
  allowedRuntimes: ["direct-http"],
};

const candidate: ProviderCycleCandidate = {
  id: "lane-1",
  providerId: "testprovider",
  priority: 0,
};

function failure(
  failureClass: ProviderCycleFailure["failureClass"],
  message = `${failureClass} happened`,
  retryable = true,
): ProviderCycleFailure {
  return {
    providerId: candidate.providerId,
    candidateId: candidate.id,
    failureClass,
    message,
    retryable,
    at: NOW,
  };
}

describe("cycleExhaustedResult", () => {
  test("the terminal classified failure is the headline, not lane detail", () => {
    const result = cycleExhaustedResult({
      input,
      context,
      providerId: "testprovider",
      attempts: [
        { failure: failure("candidate-empty", "lane empty") },
        { failure: failure("candidate-server-error", "seed HTTP 502") },
      ],
      fallback: { code: "not-found", message: "no playable source", retryable: false },
      evidence: {
        // Lane detail from an earlier, differently-classified lane must sit
        // behind the terminal verdict — failures[0] is what the engine throws.
        failures: [
          {
            providerId: "testprovider",
            code: "not-found",
            message: "lane empty",
            retryable: false,
            at: NOW,
          },
        ],
      },
    });

    expect(result.status).toBe("exhausted");
    expect(result.failures[0]?.code).toBe("provider-unavailable");
    expect(result.failures[0]?.message).toBe("seed HTTP 502");
    expect(result.failures[1]?.code).toBe("not-found");
  });

  test("a headline already present in detail is not duplicated", () => {
    const result = cycleExhaustedResult({
      input,
      context,
      providerId: "testprovider",
      attempts: [{ failure: failure("candidate-timeout", "lane timed out") }],
      fallback: { code: "not-found", message: "no playable source", retryable: false },
      evidence: {
        failures: [
          {
            providerId: "testprovider",
            code: "timeout",
            message: "lane timed out",
            retryable: true,
            at: NOW,
          },
        ],
      },
    });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.code).toBe("timeout");
  });

  test("a cycle that never attempted falls back to the provider's generic failure", () => {
    const result = cycleExhaustedResult({
      input,
      context,
      providerId: "testprovider",
      attempts: [],
      fallback: { code: "not-found", message: "no playable source", retryable: false },
    });

    expect(result.failures[0]?.code).toBe("not-found");
    expect(result.failures[0]?.message).toBe("no playable source");
  });

  test("a cancelled terminal failure stays health-neutral", () => {
    const result = cycleExhaustedResult({
      input,
      context,
      providerId: "testprovider",
      attempts: [
        { failure: failure("candidate-user-cancelled", "Provider cycle cancelled", false) },
      ],
      fallback: { code: "not-found", message: "no playable source", retryable: false },
    });

    expect(result.failures[0]?.code).toBe("cancelled");
    // A quit is not evidence about the provider — no negative health delta.
    expect(result.healthDelta).toBeUndefined();
  });

  test("cycle events pass through ahead of the synthetic exhausted event", () => {
    const result = cycleExhaustedResult({
      input,
      context,
      providerId: "testprovider",
      attempts: [{ failure: failure("candidate-empty") }],
      fallback: { code: "not-found", message: "no playable source", retryable: false },
      evidence: {
        events: [
          {
            type: "source:start",
            at: NOW,
            providerId: "testprovider",
            message: "lane-1",
          },
        ],
      },
    });

    const events = result.trace.events ?? [];
    expect(events[0]?.type).toBe("source:start");
    expect(events.at(-1)?.type).toBe("provider:exhausted");
  });
});

describe("cycle failure <-> provider code mapping", () => {
  test("every non-empty cycle class round-trips through the provider vocabulary", () => {
    const classes: readonly ProviderCycleFailure["failureClass"][] = [
      "candidate-timeout",
      "candidate-network",
      "candidate-expired",
      "candidate-blocked",
      "candidate-rate-limited",
      "candidate-server-error",
      "candidate-parse",
      "candidate-unsupported",
      "candidate-user-cancelled",
    ];
    for (const failureClass of classes) {
      const code = providerFailureCodeFromCycleFailure(failureClass);
      expect(code).not.toBe("unknown");
      // The inverse lands on the same class for every distinguishable code.
      expect(cycleFailureClassFromProviderCode(code)).toBe(failureClass);
    }
  });
});
