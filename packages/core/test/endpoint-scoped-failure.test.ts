import { describe, expect, test } from "bun:test";

import { classifyEndpointFailureFromCycleFailure } from "../src/provider-cycle-engine";

/**
 * `candidate-blocked` is deliberately not endpoint evidence: it lumps together
 * provider-wide session guards, region-wide WAF responses, and endpoint-local
 * refusals, and persisting all of those would quarantine healthy mirrors after
 * two titles merely because the user has no valid session.
 *
 * A resolve-gate rejection is different in kind. It is a segment probe against
 * one server's own stream, and a *definitive* refusal there is about that
 * server and nothing else. The failure contract carries that distinction
 * explicitly rather than making the classifier guess from a message string.
 */
const base = {
  providerId: "rivestream",
  candidateId: "candidate-1",
  message: "stream is unreachable (HLS segment unreachable: HTTP 403)",
  retryable: false,
  at: "2026-09-09T00:00:00.000Z",
} as const;

describe("classifyEndpointFailureFromCycleFailure", () => {
  test("an unscoped block is still not endpoint evidence", () => {
    expect(
      classifyEndpointFailureFromCycleFailure({ ...base, failureClass: "candidate-blocked" }),
    ).toBeNull();
  });

  test("an endpoint-scoped block is a server error for that endpoint", () => {
    expect(
      classifyEndpointFailureFromCycleFailure({
        ...base,
        failureClass: "candidate-blocked",
        endpointScoped: true,
      }),
    ).toBe("server-error");
  });

  test("endpointScoped does not promote a timeout", () => {
    // A slow link must never quarantine a working mirror, so the scoped flag
    // only sharpens a block — it cannot turn an inconclusive result into
    // durable evidence.
    expect(
      classifyEndpointFailureFromCycleFailure({
        ...base,
        failureClass: "candidate-timeout",
        endpointScoped: true,
      }),
    ).toBe("transient");
  });

  test("an empty candidate stays unrecorded whether scoped or not", () => {
    expect(
      classifyEndpointFailureFromCycleFailure({
        ...base,
        failureClass: "candidate-empty",
        endpointScoped: true,
      }),
    ).toBeNull();
  });
});
