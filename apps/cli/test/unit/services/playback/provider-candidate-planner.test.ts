import { describe, expect, test } from "bun:test";

import type { RecoveryMode } from "@/domain/recovery/RecoveryPolicy";
import { planProviderCandidates } from "@/services/playback/ProviderCandidatePlanner";
import type { MediaKind, ProviderHealth, ProviderId } from "@kunai/types";

describe("ProviderCandidatePlanner", () => {
  test("filters fallback providers by media kind and down health", () => {
    expect(
      planProviderCandidates({
        primaryProviderId: "primary" as ProviderId,
        mediaKind: "anime",
        recoveryMode: "fallback-first",
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
                checkedAt: "2026-05-28T00:00:00.000Z",
              }
            : undefined,
      }),
    ).toEqual({
      candidateIds: ["primary", "anime-ok"],
      hasCompatibleFallback: true,
    });
  });

  test("can ignore provider health for an explicit recompute", () => {
    expect(
      planProviderCandidates({
        primaryProviderId: "primary" as ProviderId,
        mediaKind: "series",
        recoveryMode: "fallback-first",
        ignoreProviderHealth: true,
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
                checkedAt: "2026-05-28T00:00:00.000Z",
              }
            : undefined,
      }),
    ).toEqual({
      candidateIds: ["primary", "fallback-down", "fallback-ok"],
      hasCompatibleFallback: true,
    });
  });

  test("keeps title health suggestions advisory and walks full provider priority in guided mode", () => {
    expect(
      planProviderCandidates({
        primaryProviderId: "primary" as ProviderId,
        mediaKind: "series",
        recoveryMode: "guided",
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
    });
  });

  test("manual recovery stays on the selected provider while reporting fallback availability", () => {
    expect(
      planProviderCandidates({
        primaryProviderId: "primary" as ProviderId,
        mediaKind: "series",
        recoveryMode: "manual",
        modules: [module("primary", ["series"]), module("fallback", ["series"])],
      }),
    ).toEqual({
      candidateIds: ["primary"],
      hasCompatibleFallback: true,
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
