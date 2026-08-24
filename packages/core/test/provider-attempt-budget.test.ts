import { describe, expect, test } from "bun:test";

import type { StartupPriority } from "@kunai/types";

import {
  providerAttemptTimeoutMs,
  providerCycleCandidateTimeoutMs,
} from "../src/provider-attempt-budget";

const PRIORITIES: readonly StartupPriority[] = ["fast", "balanced", "quality-first"];

describe("provider attempt budget", () => {
  test("a candidate can never outlive the attempt it runs inside", () => {
    // Miruro and Videasy both shipped a 20s candidate timeout inside a 12s
    // attempt, so the bound was dead code and one hung mirror ate the attempt.
    for (const priority of PRIORITIES) {
      expect(providerCycleCandidateTimeoutMs(priority)).toBeLessThan(
        providerAttemptTimeoutMs(priority),
      );
    }
  });

  test("a provider's own choice is honoured when it fits", () => {
    // Miruro wants a short bound so it can walk past a blocked mirror.
    expect(providerCycleCandidateTimeoutMs("balanced", 5_000)).toBe(5_000);
  });

  test("an over-budget provider choice is clamped, not obeyed", () => {
    // Videasy asked for 20s inside a 12s attempt; the clamp is what makes the
    // per-candidate failure attributable instead of killing the whole attempt.
    const clamped = providerCycleCandidateTimeoutMs("balanced", 20_000);
    expect(clamped).toBeLessThan(providerAttemptTimeoutMs("balanced"));
    expect(clamped).toBe(9_600);
  });

  test("no provider choice can outlive its attempt on any profile", () => {
    for (const priority of PRIORITIES) {
      for (const preferred of [1_000, 5_000, 20_000, 120_000]) {
        expect(providerCycleCandidateTimeoutMs(priority, preferred)).toBeLessThan(
          providerAttemptTimeoutMs(priority),
        );
      }
    }
  });

  test("a working ~3s candidate survives on every profile", () => {
    // Live Videasy resolves Yoru in ~3s; the clamp must not cut it off, which a
    // tighter ratio did on the `fast` profile.
    for (const priority of PRIORITIES) {
      expect(providerCycleCandidateTimeoutMs(priority, 20_000)).toBeGreaterThan(3_000);
    }
  });

  test("budgets grow with the startup profile", () => {
    expect(providerAttemptTimeoutMs("fast")).toBeLessThan(providerAttemptTimeoutMs("balanced"));
    expect(providerAttemptTimeoutMs("balanced")).toBeLessThan(
      providerAttemptTimeoutMs("quality-first"),
    );
  });
});
