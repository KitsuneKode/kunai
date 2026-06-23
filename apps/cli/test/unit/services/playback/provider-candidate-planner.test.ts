import { describe, expect, test } from "bun:test";

import type { RecoveryMode } from "@/domain/recovery/RecoveryPolicy";
import { planProviderCandidates } from "@/services/playback/ProviderCandidatePlanner";
import type { MediaKind, ProviderHealth, ProviderId } from "@kunai/types";

describe("ProviderCandidatePlanner", () => {
  const now = () => new Date("2026-06-23T12:00:00.000Z");

  test("filters fallback providers by media kind and down health", () => {
    expect(
      planProviderCandidates({
        primaryProviderId: "primary" as ProviderId,
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
        primaryProviderId: "primary" as ProviderId,
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
        primaryProviderId: "primary" as ProviderId,
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

  test("keeps title health suggestions advisory and walks full provider priority in guided mode", () => {
    expect(
      planProviderCandidates({
        primaryProviderId: "primary" as ProviderId,
        mediaKind: "series",
        recoveryMode: "guided",
        now,
        modules: [
          module("primary", ["series"]),
          module("fallback-a", ["series"]),
          module("fallback-b", ["series"]),
        ],
        suggestion: {
          providerId: "primary",
          suggestedProviderId: "fallback-b",
        },
      }),
    ).toEqual({
      candidateIds: ["primary", "fallback-a", "fallback-b"],
      hasCompatibleFallback: true,
      skippedFallbackProviders: [],
    });
  });

  test("manual recovery stays on the selected provider while reporting fallback availability", () => {
    expect(
      planProviderCandidates({
        primaryProviderId: "primary" as ProviderId,
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
});

function module(providerId: string, mediaKinds: readonly MediaKind[]) {
  return {
    providerId: providerId as ProviderId,
    manifest: { mediaKinds },
  };
}

type _RecoveryModeContract = RecoveryMode;
type _ProviderHealthContract = ProviderHealth;
