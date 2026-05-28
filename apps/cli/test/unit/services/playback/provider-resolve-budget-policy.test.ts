import { describe, expect, test } from "bun:test";

import { resolveProviderAttemptTimeoutMs } from "@/services/playback/provider-resolve-budget-policy";

describe("provider resolve budget policy", () => {
  test("maps startup priority to explicit provider attempt timeouts", () => {
    expect(resolveProviderAttemptTimeoutMs("fast")).toBe(90_000);
    expect(resolveProviderAttemptTimeoutMs("balanced")).toBe(300_000);
    expect(resolveProviderAttemptTimeoutMs("quality-first")).toBe(300_000);
  });
});
