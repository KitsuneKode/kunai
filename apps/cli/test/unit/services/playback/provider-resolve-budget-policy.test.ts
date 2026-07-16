import { describe, expect, test } from "bun:test";

import {
  resolveProviderAttemptTimeoutMs,
  resolveProviderMaxAttempts,
  resolveProviderTotalDeadlineMs,
} from "@/services/playback/provider-resolve-budget-policy";

describe("provider resolve budget policy", () => {
  test("maps startup priority to explicit provider attempt timeouts", () => {
    expect(resolveProviderAttemptTimeoutMs("fast")).toBe(6_000);
    expect(resolveProviderAttemptTimeoutMs("balanced")).toBe(12_000);
    expect(resolveProviderAttemptTimeoutMs("quality-first")).toBe(30_000);
  });

  test("bounds retries and total sequential fan-out by startup priority", () => {
    expect(resolveProviderMaxAttempts("fast")).toBe(1);
    expect(resolveProviderMaxAttempts("balanced")).toBe(2);
    expect(resolveProviderMaxAttempts("quality-first")).toBe(3);

    expect(resolveProviderTotalDeadlineMs("fast")).toBe(15_000);
    expect(resolveProviderTotalDeadlineMs("balanced")).toBe(45_000);
    expect(resolveProviderTotalDeadlineMs("quality-first")).toBe(120_000);
  });
});
