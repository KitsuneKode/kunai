import { describe, expect, test } from "bun:test";

import {
  selectShadowProbeTarget,
  type ShadowProbeInput,
} from "@/services/playback/provider-shadow-probe";

const NOW = Date.parse("2026-07-28T12:00:00.000Z");
const now = () => NOW;
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

function input(overrides: Partial<ShadowProbeInput>): ShadowProbeInput {
  return { candidates: [], health: {}, activeProviderId: "videasy", now, ...overrides };
}

describe("selectShadowProbeTarget", () => {
  test("picks a down provider that is otherwise unreachable", () => {
    const target = selectShadowProbeTarget(
      input({
        candidates: ["videasy", "vidlink"],
        health: {
          videasy: { effectiveStatus: "healthy", checkedAt: hoursAgo(1) },
          vidlink: { effectiveStatus: "down", checkedAt: hoursAgo(2) },
        },
        activeProviderId: "videasy",
      }),
    );

    expect(target).toBe("vidlink");
  });

  test("never probes the provider actually serving this resolve", () => {
    const target = selectShadowProbeTarget(
      input({
        candidates: ["vidlink"],
        health: { vidlink: { effectiveStatus: "down", checkedAt: hoursAgo(2) } },
        activeProviderId: "vidlink",
      }),
    );

    expect(target).toBeNull();
  });

  test("probes at most one provider — the stalest", () => {
    const target = selectShadowProbeTarget(
      input({
        candidates: ["a", "b", "c"],
        health: {
          a: { effectiveStatus: "down", checkedAt: hoursAgo(1) },
          b: { effectiveStatus: "down", checkedAt: hoursAgo(9) },
          c: { effectiveStatus: "down", checkedAt: hoursAgo(3) },
        },
        activeProviderId: "z",
      }),
    );

    expect(target).toBe("b");
  });

  test("returns null when nothing is down", () => {
    const target = selectShadowProbeTarget(
      input({
        candidates: ["videasy"],
        health: { videasy: { effectiveStatus: "healthy", checkedAt: hoursAgo(1) } },
        activeProviderId: "vidlink",
      }),
    );

    expect(target).toBeNull();
  });

  test("does not re-probe a provider checked moments ago", () => {
    // Otherwise a burst of resolves turns recovery into request amplification.
    const target = selectShadowProbeTarget(
      input({
        candidates: ["vidlink"],
        health: { vidlink: { effectiveStatus: "down", checkedAt: new Date(NOW).toISOString() } },
        activeProviderId: "videasy",
      }),
    );

    expect(target).toBeNull();
  });

  test("degraded providers are not probed — they are still eligible normally", () => {
    const target = selectShadowProbeTarget(
      input({
        candidates: ["vidlink"],
        health: { vidlink: { effectiveStatus: "degraded", checkedAt: hoursAgo(5) } },
        activeProviderId: "videasy",
      }),
    );

    expect(target).toBeNull();
  });

  test("an unparseable timestamp counts as fully stale, not freshly checked", () => {
    const target = selectShadowProbeTarget(
      input({
        candidates: ["vidlink"],
        health: { vidlink: { effectiveStatus: "down", checkedAt: "not-a-date" } },
        activeProviderId: "videasy",
      }),
    );

    expect(target).toBe("vidlink");
  });

  test("a provider with no health record at all is not probed", () => {
    // No record means never tried, not known-down. Normal fallback covers it.
    const target = selectShadowProbeTarget(
      input({ candidates: ["vidlink"], health: {}, activeProviderId: "videasy" }),
    );

    expect(target).toBeNull();
  });
});
