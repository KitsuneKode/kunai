import { describe, expect, test } from "bun:test";

import {
  computeProviderHealthUpdate,
  nextFailureRate,
  nextObservations,
} from "@/services/playback/provider-health-observation";

describe("nextFailureRate", () => {
  test("a first-ever failure is not reported as total failure", () => {
    // The old seed was 1.0, which made one bad night look identical to a
    // permanently dead provider.
    expect(nextFailureRate(undefined, true)).toBeCloseTo(0.3, 5);
  });

  test("a first-ever success is zero", () => {
    expect(nextFailureRate(undefined, false)).toBe(0);
  });

  test("sustained failure climbs toward one without reaching it early", () => {
    let rate = nextFailureRate(undefined, true);
    const seen = [rate];
    for (let i = 0; i < 4; i++) {
      rate = nextFailureRate(rate, true);
      seen.push(rate);
    }
    // Strictly increasing, and still below the degrade threshold after two
    // failures — evidence has to accumulate.
    expect(seen[1]).toBeGreaterThan(seen[0] ?? 0);
    expect(seen[1]).toBeLessThan(0.75);
    expect(rate).toBeGreaterThan(0.75);
    expect(rate).toBeLessThanOrEqual(1);
  });

  test("recovery pulls the rate back down", () => {
    let rate = 0.9;
    for (let i = 0; i < 5; i++) rate = nextFailureRate(rate, false);
    expect(rate).toBeLessThan(0.25);
  });

  test("stays inside [0, 1] even with corrupt stored input", () => {
    expect(nextFailureRate(42, true)).toBeLessThanOrEqual(1);
    expect(nextFailureRate(-13, false)).toBeGreaterThanOrEqual(0);
    expect(nextFailureRate(Number.NaN, true)).toBeCloseTo(0.3, 5);
  });
});

describe("nextObservations", () => {
  test("counts up from absent", () => {
    expect(nextObservations(undefined)).toBe(1);
    expect(nextObservations(4)).toBe(5);
  });

  test("treats corrupt stored input as no history", () => {
    expect(nextObservations(Number.NaN)).toBe(1);
    expect(nextObservations(-3)).toBe(1);
  });
});

describe("computeProviderHealthUpdate", () => {
  const at = "2026-07-28T00:00:00.000Z";

  test("records how many outcomes back the rate", () => {
    const first = computeProviderHealthUpdate(undefined, {
      providerId: "vidlink",
      outcome: "failure",
      at,
    });
    expect(first.observations).toBe(1);
    expect(first.recentFailureRate).toBeCloseTo(0.3, 5);

    const second = computeProviderHealthUpdate(first, {
      providerId: "vidlink",
      outcome: "failure",
      at,
    });
    expect(second.observations).toBe(2);
  });

  test("a single failure no longer reports a total failure rate", () => {
    const update = computeProviderHealthUpdate(undefined, {
      providerId: "vidlink",
      outcome: "failure",
      at,
    });
    // The old seed was 1.0, which is why vidlink read as 100% broken after
    // one bad attempt.
    expect(update.recentFailureRate).toBeLessThan(0.5);
  });

  test("keeps the existing consecutive-failure status thresholds", () => {
    let current = computeProviderHealthUpdate(undefined, {
      providerId: "p",
      outcome: "failure",
      at,
    });
    expect(current.status).toBe("healthy");
    current = computeProviderHealthUpdate(current, { providerId: "p", outcome: "failure", at });
    expect(current.status).toBe("degraded");
    for (let i = 0; i < 3; i++) {
      current = computeProviderHealthUpdate(current, { providerId: "p", outcome: "failure", at });
    }
    expect(current.status).toBe("down");
  });

  test("a success resets consecutive failures and heals status immediately", () => {
    let current = computeProviderHealthUpdate(undefined, {
      providerId: "p",
      outcome: "failure",
      at,
    });
    current = computeProviderHealthUpdate(current, { providerId: "p", outcome: "failure", at });
    expect(current.status).toBe("degraded");

    const healed = computeProviderHealthUpdate(current, {
      providerId: "p",
      outcome: "success",
      at,
    });
    expect(healed.consecutiveFailures).toBe(0);
    expect(healed.status).toBe("healthy");
  });

  test("a stall resets consecutive failures but still counts against the rate", () => {
    // Preserved from the original implementation. The asymmetry is deliberate
    // here only in the sense that changing it is a separate decision.
    const stalled = computeProviderHealthUpdate(undefined, {
      providerId: "p",
      outcome: "stalled",
      at,
    });
    expect(stalled.consecutiveFailures).toBe(0);
    expect(stalled.recentFailureRate).toBeGreaterThan(0);
  });

  test("carries the resolve latency through", () => {
    const update = computeProviderHealthUpdate(undefined, {
      providerId: "p",
      outcome: "success",
      at,
      resolveMs: 1234,
    });
    expect(update.medianResolveMs).toBe(1234);
    expect(update.checkedAt).toBe(at);
  });
});
