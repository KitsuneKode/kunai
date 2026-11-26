import { describe, expect, test } from "bun:test";

import {
  acceptResolvedProviderForPlayback,
  resolvePlaybackResolvePolicy,
} from "@/app/playback/playback-resolve-policy";

describe("resolvePlaybackResolvePolicy", () => {
  test("manual provider switch forces fresh state without disabling guided fallback", () => {
    const policy = resolvePlaybackResolvePolicy({
      recomputeSources: false,
      pendingUserProviderSwitch: true,
      sourceRefreshDecision: null,
      configuredRecoveryMode: "guided",
    });

    expect(policy).toMatchObject({
      honorExplicitProviderOnly: false,
      preferFreshStream: true,
      forceHealthCheck: true,
      shouldInvalidateSuspectResolveState: true,
      ignoreProviderHealth: false,
      ignoreTitleHealthSuggestion: false,
      recoveryMode: "guided",
      resolveIntent: "play",
    });
  });

  test("manual recovery mode keeps explicit provider switch provider-only", () => {
    const policy = resolvePlaybackResolvePolicy({
      recomputeSources: false,
      pendingUserProviderSwitch: true,
      sourceRefreshDecision: null,
      configuredRecoveryMode: "manual",
    });

    expect(policy).toMatchObject({
      honorExplicitProviderOnly: true,
      preferFreshStream: true,
      shouldInvalidateSuspectResolveState: true,
      ignoreProviderHealth: true,
      ignoreTitleHealthSuggestion: true,
      recoveryMode: "manual",
    });
  });

  test("recover invalidates suspect cache and refresh preserves playable cache on miss", () => {
    expect(
      resolvePlaybackResolvePolicy({
        recomputeSources: false,
        pendingUserProviderSwitch: false,
        sourceRefreshDecision: {
          kind: "recover",
          bypassCache: true,
          invalidateSuspectCache: true,
        },
        configuredRecoveryMode: "guided",
      }),
    ).toMatchObject({
      preferFreshStream: true,
      forceHealthCheck: true,
      preserveCachedStreamOnFreshFailure: false,
      shouldInvalidateSuspectResolveState: true,
    });

    expect(
      resolvePlaybackResolvePolicy({
        recomputeSources: false,
        pendingUserProviderSwitch: false,
        sourceRefreshDecision: {
          kind: "refresh",
          bypassCache: true,
          invalidateSuspectCache: false,
        },
        configuredRecoveryMode: "guided",
      }),
    ).toMatchObject({
      preferFreshStream: true,
      forceHealthCheck: false,
      preserveCachedStreamOnFreshFailure: true,
      shouldInvalidateSuspectResolveState: false,
    });
  });
});

describe("acceptResolvedProviderForPlayback", () => {
  const policyFor = (input: {
    readonly recomputeSources?: boolean;
    readonly configuredRecoveryMode: "guided" | "manual" | "fallback-first";
  }) =>
    resolvePlaybackResolvePolicy({
      recomputeSources: input.recomputeSources ?? false,
      pendingUserProviderSwitch: true,
      sourceRefreshDecision: null,
      configuredRecoveryMode: input.configuredRecoveryMode,
    });

  test("a guided switch keeps the working fallback the engine found", () => {
    // The user switched to vidlink (which also saved it as this title's
    // provider); vidlink failed and the engine fell back to videasy.
    expect(
      acceptResolvedProviderForPlayback({
        policy: policyFor({ configuredRecoveryMode: "guided" }),
        requestedProviderId: "vidlink",
        resolvedProviderId: "videasy",
      }),
    ).toBe(true);
    expect(
      acceptResolvedProviderForPlayback({
        policy: policyFor({ configuredRecoveryMode: "fallback-first" }),
        requestedProviderId: "vidlink",
        resolvedProviderId: "videasy",
      }),
    ).toBe(true);
  });

  test("provider-only requests refuse an alternative but accept the provider asked for", () => {
    for (const policy of [
      policyFor({ configuredRecoveryMode: "manual" }),
      policyFor({ configuredRecoveryMode: "guided", recomputeSources: true }),
    ]) {
      expect(
        acceptResolvedProviderForPlayback({
          policy,
          requestedProviderId: "vidlink",
          resolvedProviderId: "videasy",
        }),
      ).toBe(false);
      expect(
        acceptResolvedProviderForPlayback({
          policy,
          requestedProviderId: "vidlink",
          resolvedProviderId: "vidlink",
        }),
      ).toBe(true);
    }
  });
});
