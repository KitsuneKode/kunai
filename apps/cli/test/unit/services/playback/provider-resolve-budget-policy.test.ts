import { describe, expect, test } from "bun:test";

import { resolveProviderAttemptTimeoutMs } from "@/services/playback/provider-resolve-budget-policy";

describe("provider resolve budget policy", () => {
  test("maps startup priority to explicit provider attempt timeouts", () => {
    expect(resolveProviderAttemptTimeoutMs("fast")).toBe(6_000);
    expect(resolveProviderAttemptTimeoutMs("balanced")).toBe(12_000);
    expect(resolveProviderAttemptTimeoutMs("quality-first")).toBe(30_000);
  });
});
