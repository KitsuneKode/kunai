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
