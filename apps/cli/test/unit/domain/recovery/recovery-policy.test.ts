import { describe, expect, test } from "bun:test";

import { decideRecovery } from "@/domain/recovery/RecoveryPolicy";

const base = {
  mode: "guided" as const,
  intent: "automatic" as const,
  network: "online" as const,
  cache: "none" as const,
  compatibleProviderAvailable: true,
};

describe("RecoveryPolicy", () => {
  test("uses fresh cache without provider work", () => {
    expect(decideRecovery({ ...base, cache: "fresh" }).decision).toBe("use-cache");
  });

  test("does not punish providers for local network unavailable", () => {
    const decision = decideRecovery({ ...base, network: "offline", failureClass: "network" });

    expect(decision.decision).toBe("ask-user");
    expect(decision.reason).toBe("network-unavailable");
    expect(decision.providerHealthPenalty).toBe(false);
  });

  test("guided mode retries one transient provider failure", () => {
    expect(decideRecovery({ ...base, failureClass: "timeout", retryCount: 0 }).decision).toBe(
      "retry-primary",
    );
    expect(decideRecovery({ ...base, failureClass: "timeout", retryCount: 1 }).decision).toBe(
      "auto-fallback",
    );
  });

  test("manual mode asks instead of automatic fallback", () => {
    expect(
      decideRecovery({
        ...base,
        mode: "manual",
        failureClass: "provider-empty",
        compatibleProviderAvailable: true,
      }).decision,
    ).toBe("ask-user");
  });

  test("fallback-first can auto-fallback after the slow grace budget", () => {
    expect(
      decideRecovery({
        ...base,
        mode: "fallback-first",
        slowResolveMs: 16_000,
        slowResolveThresholdMs: 15_000,
        fallbackCount: 0,
      }).decision,
    ).toBe("auto-fallback");
  });

  test("explicit down provider selection gets one primary attempt", () => {
    expect(
      decideRecovery({
        ...base,
        intent: "explicit-provider",
        providerHealth: { status: "down" },
        retryCount: 0,
      }).reason,
    ).toBe("explicit-down-provider-once");
  });

  test("automatic routing skips providers marked down", () => {
    const decision = decideRecovery({
      ...base,
      providerHealth: { status: "down" },
      compatibleProviderAvailable: true,
    });

    expect(decision.decision).toBe("auto-fallback");
    expect(decision.reason).toBe("provider-health-down");
    expect(decision.providerHealthPenalty).toBe(false);
  });

  test("health probe timeout proceeds with warning when a stream is available", () => {
    expect(
      decideRecovery({
        ...base,
        cache: "health-timeout",
        playableStreamAvailable: true,
      }).decision,
    ).toBe("proceed-with-warning");
  });
});
