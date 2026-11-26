import { describe, expect, test } from "bun:test";

import type { RecoveryMode } from "@/domain/recovery/RecoveryPolicy";
import { planProviderCandidates } from "@/services/playback/ProviderCandidatePlanner";
import type { MediaKind, ProviderHealth } from "@kunai/types";

describe("ProviderCandidatePlanner", () => {
  const now = () => new Date("2026-06-23T12:00:00.000Z");

  test("filters fallback providers by media kind and down health", () => {
    expect(
      planProviderCandidates({
        primaryProviderId: "primary",
        mediaKind: "anime",
        recoveryMode: "fallback-first",
        now,
        modules: [
          module("primary", ["anime"]),
          module("anime-ok", ["anime"]),
          module("series-only", ["series", "movie"]),
          module("anime-down", ["anime"]),
        ],
        getProviderHealth: (providerId) =>
          providerId === "anime-down"
            ? {
                providerId,
                status: "down",
                checkedAt: "2026-06-23T11:00:00.000Z",
                consecutiveFailures: 5,
              }
            : undefined,
      }),
    ).toEqual({
      candidateIds: ["primary", "anime-ok"],
      hasCompatibleFallback: true,
      skippedFallbackProviders: [
        {
          reason: "media-kind",
          providerId: "series-only",
          requestedMediaKind: "anime",
          supportedMediaKinds: ["series", "movie"],
        },
        {
          reason: "health",
          providerId: "anime-down",
          effectiveHealth: expect.objectContaining({
            effectiveStatus: "down",
            consecutiveFailures: 5,
          }),
        },
      ],
    });
  });

  test("includes down providers after TTL auto-heal", () => {
    expect(
      planProviderCandidates({
        primaryProviderId: "primary",
        mediaKind: "anime",
        recoveryMode: "fallback-first",
        now,
        modules: [module("primary", ["anime"]), module("anime-down", ["anime"])],
        getProviderHealth: (providerId) =>
          providerId === "anime-down"
            ? {
                providerId,
                status: "down",
                checkedAt: "2026-06-23T03:00:00.000Z",
                consecutiveFailures: 7,
              }
            : undefined,
      }),
    ).toEqual({
      candidateIds: ["primary", "anime-down"],
      hasCompatibleFallback: true,
      skippedFallbackProviders: [],
    });
  });

  test("can ignore provider health for an explicit recompute", () => {
    expect(
      planProviderCandidates({
        primaryProviderId: "primary",
        mediaKind: "series",
        recoveryMode: "fallback-first",
        ignoreProviderHealth: true,
        now,
        modules: [
          module("primary", ["series"]),
          module("fallback-down", ["series"]),
          module("fallback-ok", ["series"]),
        ],
        getProviderHealth: (providerId) =>
          providerId === "fallback-down"
            ? {
                providerId,
                status: "down",
                checkedAt: "2026-06-23T11:00:00.000Z",
              }
            : undefined,
      }),
    ).toEqual({
      candidateIds: ["primary", "fallback-down", "fallback-ok"],
      hasCompatibleFallback: true,
      skippedFallbackProviders: [],
    });
  });

  test("a title suggestion leads in guided mode, then the selected provider, then the rest", () => {
    const plan = planProviderCandidates({
      primaryProviderId: "primary",
      mediaKind: "series",
      recoveryMode: "guided",
      now,
      modules: [
        module("primary", ["series"]),
        module("fallback-a", ["series"]),
        module("fallback-b", ["series"]),
      ],
      suggestion: { providerId: "primary", suggestedProviderId: "fallback-b" },
      nameOf: (id) => id.toUpperCase(),
    });
    expect(plan.candidateIds).toEqual(["fallback-b", "primary", "fallback-a"]);
    expect(plan.orderNote).toBe("Trying FALLBACK-B first: it worked for this title before.");
  });

  test("a suggestion for another provider, or one not offered here, changes nothing", () => {
    const base = {
      primaryProviderId: "primary",
      mediaKind: "series" as const,
      recoveryMode: "guided" as const,
      now,
      modules: [module("primary", ["series"]), module("fallback-a", ["series"])],
    };
    expect(
      planProviderCandidates({
        ...base,
        suggestion: { providerId: "other", suggestedProviderId: "fallback-a" },
      }).candidateIds,
    ).toEqual(["primary", "fallback-a"]);
    expect(
      planProviderCandidates({
        ...base,
        suggestion: { providerId: "primary", suggestedProviderId: "not-installed" },
      }).candidateIds,
    ).toEqual(["primary", "fallback-a"]);
  });

  test("a selected provider that is down goes last, still tried, with a note", () => {
    const plan = planProviderCandidates({
      primaryProviderId: "primary",
      mediaKind: "series",
      recoveryMode: "fallback-first",
      now,
      modules: [module("primary", ["series"]), module("fallback-a", ["series"])],
      getProviderHealth: (id) =>
        id === "primary"
          ? {
              providerId: "primary",
              status: "down",
              checkedAt: now().toISOString(),
              consecutiveFailures: 3,
            }
          : undefined,
    });
    expect(plan.candidateIds).toEqual(["fallback-a", "primary"]);
    expect(plan.orderNote).toBe("primary is down (3 failures), so it is tried last.");
  });

  test("a provider the user just chose leads even when down, and suggestions wait", () => {
    const plan = planProviderCandidates({
      primaryProviderId: "primary",
      mediaKind: "series",
      recoveryMode: "guided",
      now,
      keepPrimaryFirst: true,
      modules: [module("primary", ["series"]), module("fallback-a", ["series"])],
      getProviderHealth: (id) =>
        id === "primary"
          ? { providerId: "primary", status: "down", checkedAt: now().toISOString() }
          : undefined,
      suggestion: { providerId: "primary", suggestedProviderId: "fallback-a" },
    });
    expect(plan.candidateIds).toEqual(["primary", "fallback-a"]);
    expect(plan.orderNote).toBeUndefined();
  });

  test("manual recovery stays on the selected provider while reporting fallback availability", () => {
    expect(
      planProviderCandidates({
        primaryProviderId: "primary",
        mediaKind: "series",
        recoveryMode: "manual",
        now,
        modules: [module("primary", ["series"]), module("fallback", ["series"])],
      }),
    ).toEqual({
      candidateIds: ["primary"],
      hasCompatibleFallback: true,
      skippedFallbackProviders: [],
    });
  });

  test("orders fallbacks by health, leaving the selected provider first", () => {
    // The primary is the user's explicit choice for this resolve and leads even
    // when a fallback is measurably healthier.
    const plan = planProviderCandidates({
      primaryProviderId: "primary",
      mediaKind: "series",
      recoveryMode: "fallback-first",
      now,
      modules: [
        module("primary", ["series"]),
        module("wobbly", ["series"]),
        module("solid", ["series"]),
      ],
      getProviderHealth: (providerId) =>
        providerId === "wobbly"
          ? {
              providerId,
              status: "degraded",
              checkedAt: "2026-06-23T11:59:00.000Z",
              consecutiveFailures: 1,
            }
          : undefined,
    });

    expect(plan.candidateIds).toEqual(["primary", "solid", "wobbly"]);
  });

  test("latency breaks a tie between equally healthy fallbacks", () => {
    const plan = planProviderCandidates({
      primaryProviderId: "primary",
      mediaKind: "series",
      recoveryMode: "fallback-first",
      now,
      modules: [
        module("primary", ["series"]),
        module("slow", ["series"]),
        module("fast", ["series"]),
      ],
      getProviderHealth: (providerId) => ({
        providerId,
        status: "healthy",
        checkedAt: "2026-06-23T11:59:00.000Z",
        medianResolveMs: providerId === "slow" ? 8_000 : 600,
      }),
    });

    expect(plan.candidateIds).toEqual(["primary", "fast", "slow"]);
  });

  test("configured order survives when health gives no reason to reorder", () => {
    const plan = planProviderCandidates({
      primaryProviderId: "primary",
      mediaKind: "series",
      recoveryMode: "fallback-first",
      now,
      modules: [
        module("primary", ["series"]),
        module("second", ["series"]),
        module("third", ["series"]),
      ],
    });

    expect(plan.candidateIds).toEqual(["primary", "second", "third"]);
  });
});

function module(providerId: string, mediaKinds: readonly MediaKind[]) {
  return {
    providerId: providerId,
    manifest: { mediaKinds },
  };
}

type _RecoveryModeContract = RecoveryMode;
type _ProviderHealthContract = ProviderHealth;
