import { describe, expect, test } from "bun:test";

import type { ProviderCycleCandidate } from "@kunai/types";

import { createProviderCycleFailureError } from "../src/provider-cycle-engine";

const candidate = {
  id: "candidate:source:server:ep1",
  providerId: "miruro",
} as ProviderCycleCandidate;

describe("createProviderCycleFailureError", () => {
  test("forwards the core failure fields with candidate defaults", () => {
    const error = createProviderCycleFailureError(candidate, {
      failureClass: "candidate-timeout",
      message: "timed out",
      retryable: true,
      at: "2026-09-16T00:00:00.000Z",
    });
    expect(error.failure.providerId).toBe("miruro");
    expect(error.failure.candidateId).toBe("candidate:source:server:ep1");
    expect(error.failure.failureClass).toBe("candidate-timeout");
  });

  test("preserves forward-compatible failure fields instead of dropping them", () => {
    const error = createProviderCycleFailureError(candidate, {
      failureClass: "candidate-blocked",
      message: "blocked",
      retryable: false,
      at: "2026-09-16T00:00:00.000Z",
      endpointScoped: true,
    });
    expect((error.failure as unknown as Record<string, unknown>).endpointScoped).toBe(true);
  });
});
