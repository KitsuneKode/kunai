import { describe, expect, test } from "bun:test";

import { createDefaultMobileState, decodeMobileState } from "../../../src/application/mobile-state";

describe("mobile state", () => {
  test("creates a schema-one default only for a missing value", () => {
    expect(createDefaultMobileState()).toEqual({ schemaVersion: 1, hostProofRuns: 0 });
    expect(decodeMobileState(undefined)).toEqual({ schemaVersion: 1, hostProofRuns: 0 });
  });

  test("accepts the exact schema-one state", () => {
    expect(
      decodeMobileState({
        schemaVersion: 1,
        hostProofRuns: 3,
        lastResult: "handoff-accepted",
      }),
    ).toEqual({ schemaVersion: 1, hostProofRuns: 3, lastResult: "handoff-accepted" });
  });

  test("rejects malformed, future, and URL-bearing state", () => {
    for (const value of [
      null,
      { schemaVersion: 2, hostProofRuns: 0 },
      { schemaVersion: 1, hostProofRuns: -1 },
      { schemaVersion: 1, hostProofRuns: 0, lastResult: "unknown" },
      { schemaVersion: 1, hostProofRuns: 0, mediaUrl: "https://media.example" },
    ]) {
      expect(() => decodeMobileState(value)).toThrow("Invalid mobile state");
    }
  });
});
