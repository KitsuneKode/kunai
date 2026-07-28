import { describe, expect, test } from "bun:test";

import type {
  EffectiveProviderHealth,
  EffectiveProviderHealthStatus,
} from "@/services/playback/provider-health-policy";
import { orderProviderCandidates } from "@/services/playback/provider-ordering";
import type { ProviderId } from "@kunai/types";

function health(
  providerId: string,
  effectiveStatus: EffectiveProviderHealthStatus,
  medianResolveMs?: number,
): EffectiveProviderHealth {
  return {
    providerId: providerId as ProviderId,
    stored:
      medianResolveMs === undefined
        ? undefined
        : {
            providerId: providerId as ProviderId,
            status: "healthy",
            checkedAt: "2026-07-28T12:00:00.000Z",
            medianResolveMs,
          },
    effectiveStatus,
    checkedAt: "2026-07-28T12:00:00.000Z",
    consecutiveFailures: 0,
    recentFailureRate: undefined,
    healedByTtl: false,
  };
}

describe("orderProviderCandidates", () => {
  test("configured priority is preserved when health is equal", () => {
    const order = orderProviderCandidates(["c", "a", "b"] as ProviderId[], {
      a: health("a", "healthy"),
      b: health("b", "healthy"),
      c: health("c", "healthy"),
    });

    // The user's list is authoritative. This must not become a speed sort.
    expect(order).toEqual(["c", "a", "b"]);
  });

  test("degraded providers sink below healthy ones", () => {
    const order = orderProviderCandidates(["slowbut", "fine"] as ProviderId[], {
      slowbut: health("slowbut", "degraded"),
      fine: health("fine", "healthy"),
    });

    expect(order).toEqual(["fine", "slowbut"]);
  });

  test("latency breaks a tie between equally healthy providers", () => {
    const order = orderProviderCandidates(["slow", "fast"] as ProviderId[], {
      slow: health("slow", "healthy", 9_000),
      fast: health("fast", "healthy", 800),
    });

    expect(order).toEqual(["fast", "slow"]);
  });

  test("unknown latency never outranks a measured fast provider", () => {
    const order = orderProviderCandidates(["unmeasured", "fast"] as ProviderId[], {
      unmeasured: health("unmeasured", "healthy"),
      fast: health("fast", "healthy", 500),
    });

    expect(order[0]).toBe("fast");
  });

  test("health outranks latency", () => {
    const order = orderProviderCandidates(["quickbutbroken", "steady"] as ProviderId[], {
      quickbutbroken: health("quickbutbroken", "degraded", 100),
      steady: health("steady", "healthy", 5_000),
    });

    expect(order).toEqual(["steady", "quickbutbroken"]);
  });

  test("providers with no health entry keep their configured position", () => {
    const order = orderProviderCandidates(["a", "b"] as ProviderId[], {});
    expect(order).toEqual(["a", "b"]);
  });

  test("an unmeasured provider is not demoted below a degraded one", () => {
    // No data is not evidence of being broken.
    const order = orderProviderCandidates(["broken", "unmeasured"] as ProviderId[], {
      broken: health("broken", "degraded", 10),
    });

    expect(order).toEqual(["unmeasured", "broken"]);
  });

  test("ordering is stable for equal health and equal latency", () => {
    const order = orderProviderCandidates(["b", "a"] as ProviderId[], {
      a: health("a", "healthy", 1_000),
      b: health("b", "healthy", 1_000),
    });

    expect(order).toEqual(["b", "a"]);
  });

  test("does not mutate the input list", () => {
    const candidates = ["slow", "fast"] as ProviderId[];
    orderProviderCandidates(candidates, {
      slow: health("slow", "healthy", 9_000),
      fast: health("fast", "healthy", 100),
    });

    expect(candidates).toEqual(["slow", "fast"] as ProviderId[]);
  });
});
