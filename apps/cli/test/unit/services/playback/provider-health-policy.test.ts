import { describe, expect, test } from "bun:test";

import {
  formatProviderHealthBadge,
  formatProviderHealthPickerLabelSuffix,
  isProviderFallbackEligible,
  resolveEffectiveProviderHealth,
} from "@/services/playback/provider-health-policy";
import type { ProviderHealth, ProviderId } from "@kunai/types";

const NOW = new Date("2026-06-23T12:00:00.000Z");

function health(
  status: ProviderHealth["status"],
  checkedAt: string,
  consecutiveFailures = 0,
): ProviderHealth {
  return {
    providerId: "miruro" as ProviderId,
    status,
    checkedAt,
    consecutiveFailures,
  };
}

describe("provider-health-policy", () => {
  test("degraded heals to healthy after one hour", () => {
    const stored = health("degraded", "2026-06-23T10:30:00.000Z", 2);
    const effective = resolveEffectiveProviderHealth(stored, NOW);
    expect(effective?.effectiveStatus).toBe("healthy");
    expect(effective?.healedByTtl).toBe(true);
    expect(isProviderFallbackEligible(effective)).toBe(true);
  });

  test("down stays down within four hours", () => {
    const stored = health("down", "2026-06-23T10:00:00.000Z", 7);
    const effective = resolveEffectiveProviderHealth(stored, NOW);
    expect(effective?.effectiveStatus).toBe("down");
    expect(isProviderFallbackEligible(effective)).toBe(false);
    expect(formatProviderHealthBadge(effective ?? undefined, NOW)).toContain(
      "skipped in auto-fallback",
    );
  });

  test("down softens to degraded after four hours", () => {
    const stored = health("down", "2026-06-23T07:00:00.000Z", 7);
    const effective = resolveEffectiveProviderHealth(stored, NOW);
    expect(effective?.effectiveStatus).toBe("degraded");
    expect(isProviderFallbackEligible(effective)).toBe(true);
  });

  test("down fully heals after eight hours", () => {
    const stored = health("down", "2026-06-23T03:00:00.000Z", 7);
    const effective = resolveEffectiveProviderHealth(stored, NOW);
    expect(effective?.effectiveStatus).toBe("healthy");
    expect(isProviderFallbackEligible(effective)).toBe(true);
  });

  test("a corrupt health timestamp fails open instead of pinning a provider down", () => {
    const effective = resolveEffectiveProviderHealth(health("down", "not-a-date", 7), NOW);
    expect(effective?.effectiveStatus).toBe("healthy");
    expect(effective?.healedByTtl).toBe(true);
    expect(isProviderFallbackEligible(effective)).toBe(true);
  });

  test("formatProviderHealthPickerLabelSuffix only surfaces actionable states", () => {
    const down = resolveEffectiveProviderHealth(health("down", "2026-06-23T11:00:00.000Z", 3), NOW);
    expect(formatProviderHealthPickerLabelSuffix(down ?? undefined, NOW)).toContain("down");
    expect(
      formatProviderHealthPickerLabelSuffix(
        resolveEffectiveProviderHealth(health("healthy", "2026-06-23T11:00:00.000Z"), NOW),
        NOW,
      ),
    ).toBeNull();
  });
});

function rateHealth(overrides: Partial<ProviderHealth>): ProviderHealth {
  return {
    providerId: "vidlink" as ProviderId,
    status: "healthy",
    checkedAt: NOW.toISOString(),
    consecutiveFailures: 0,
    ...overrides,
  };
}

describe("failure rate feeds effective status", () => {
  test("a provider failing nearly every attempt is not healthy", () => {
    const effective = resolveEffectiveProviderHealth(
      rateHealth({ status: "healthy", recentFailureRate: 0.95, observations: 12 }),
      NOW,
    );
    expect(effective?.effectiveStatus).toBe("degraded");
  });

  test("a high rate backed by too little evidence is ignored", () => {
    const effective = resolveEffectiveProviderHealth(
      rateHealth({ status: "healthy", recentFailureRate: 1, observations: 1 }),
      NOW,
    );
    expect(effective?.effectiveStatus).toBe("healthy");
  });

  test("legacy rows without an observation count are not demoted", () => {
    // Rows written before observations existed carry the old 1.0 seed, so
    // trusting the rate alone would demote every one of them at once.
    const effective = resolveEffectiveProviderHealth(
      rateHealth({ status: "healthy", recentFailureRate: 1 }),
      NOW,
    );
    expect(effective?.effectiveStatus).toBe("healthy");
  });

  test("a healthy rate leaves status alone", () => {
    const effective = resolveEffectiveProviderHealth(
      rateHealth({ status: "healthy", recentFailureRate: 0.1, observations: 30 }),
      NOW,
    );
    expect(effective?.effectiveStatus).toBe("healthy");
  });

  test("rate never promotes a down provider", () => {
    const effective = resolveEffectiveProviderHealth(
      rateHealth({ status: "down", recentFailureRate: 0, observations: 30 }),
      NOW,
    );
    expect(effective?.effectiveStatus).toBe("down");
  });

  test("a rate demotion is not reported as TTL healing", () => {
    // healedByTtl drives the "(was X)" badge. A provider demoted by its rate
    // was not healed by anything and must not claim it was.
    const effective = resolveEffectiveProviderHealth(
      rateHealth({ status: "healthy", recentFailureRate: 0.95, observations: 12 }),
      NOW,
    );
    expect(effective?.effectiveStatus).toBe("degraded");
    expect(effective?.healedByTtl).toBe(false);
  });

  test("TTL healing is still reported when the rate also demotes", () => {
    const stale = new Date(NOW.getTime() - 9 * 60 * 60 * 1000).toISOString();
    const effective = resolveEffectiveProviderHealth(
      rateHealth({
        status: "down",
        checkedAt: stale,
        recentFailureRate: 0.95,
        observations: 12,
      }),
      NOW,
    );
    // Aged out of down into healthy, then demoted by the rate.
    expect(effective?.effectiveStatus).toBe("degraded");
    expect(effective?.healedByTtl).toBe(true);
  });
});
