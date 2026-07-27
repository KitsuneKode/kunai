import { describe, expect, test } from "bun:test";

import { nextFailureRate, nextObservations } from "@/services/playback/provider-health-observation";

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
