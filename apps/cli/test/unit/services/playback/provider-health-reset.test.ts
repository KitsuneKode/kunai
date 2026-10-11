import { describe, expect, test } from "bun:test";

import { applyProviderHealthResetScope } from "@/services/playback/provider-health-reset";
import type { ProviderId } from "@kunai/types";

function createResetContainer() {
  const globalRows = new Map<ProviderId, { status: string }>([
    // SAFETY: literal ids satisfy the branded ProviderId in test fixtures.
    ["miruro" as ProviderId, { status: "down" }],
    // SAFETY: literal ids satisfy the branded ProviderId in test fixtures.
    ["allanime" as ProviderId, { status: "degraded" }],
    // SAFETY: literal ids satisfy the branded ProviderId in test fixtures.
    ["vidking" as ProviderId, { status: "down" }],
    // SAFETY: literal ids satisfy the branded ProviderId in test fixtures.
    ["youtube" as ProviderId, { status: "down" }],
  ]);
  const titleClears: string[] = [];
  const feedback: string[] = [];
  const endpointClears: string[] = [];

  return {
    stateManager: {
      getState: () => ({
        provider: "miruro",
        currentTitle: { id: "mal:1", name: "Naruto", type: "series" as const },
      }),
    },
    providerRegistry: {
      get: (id: string) => ({ metadata: { name: id } }),
      getAll: () => [
        { metadata: { id: "miruro", isAnimeProvider: true, isYoutubeProvider: false } },
        { metadata: { id: "allanime", isAnimeProvider: true, isYoutubeProvider: false } },
        { metadata: { id: "vidking", isAnimeProvider: false, isYoutubeProvider: false } },
        { metadata: { id: "youtube", isAnimeProvider: false, isYoutubeProvider: true } },
      ],
    },
    providerHealth: {
      delete: (providerId: ProviderId) => (globalRows.delete(providerId) ? 1 : 0),
      deleteMany: (providerIds: readonly ProviderId[]) =>
        providerIds.reduce(
          (count, providerId) => count + (globalRows.delete(providerId) ? 1 : 0),
          0,
        ),
      clearAll: () => {
        const count = globalRows.size;
        globalRows.clear();
        return count;
      },
      get: (providerId: ProviderId) =>
        globalRows.has(providerId)
          ? {
              providerId,
              status: globalRows.get(providerId)!.status,
              checkedAt: new Date().toISOString(),
            }
          : undefined,
    },
    titleProviderHealth: {
      clear: (titleId: string, providerId?: string) => {
        titleClears.push(providerId ? `${titleId}:${providerId}` : titleId);
      },
      clearAll: () => {
        titleClears.push("__all__");
      },
    },
    endpointHealth: {
      deleteByProvider: (providerId: ProviderId) => {
        endpointClears.push(`provider:${providerId}`);
        return 1;
      },
      clearTitle: (titleId: string, providerId?: ProviderId) => {
        endpointClears.push(providerId ? `title:${titleId}:${providerId}` : `title:${titleId}`);
        return 1;
      },
      clearAll: () => {
        endpointClears.push("__all__");
        return 2;
      },
    },
    diagnosticsService: {
      record: () => {},
    },
    stateManagerDispatch: feedback,
    titleClears,
    endpointClears,
  };
}

describe("provider-health-reset", () => {
  test("applyProviderHealthResetScope clears current provider global health", async () => {
    const harness = createResetContainer();
    const container = {
      ...harness,
      stateManager: {
        dispatch: (action: { note?: string }) => {
          if (action.note) harness.stateManagerDispatch.push(action.note);
        },
        getState: harness.stateManager.getState,
      },
    };

    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    const result = await applyProviderHealthResetScope(container as never, "current-provider");
    expect(result.clearedGlobal).toBe(1);
    expect(harness.providerHealth.get("miruro")).toBeUndefined();
    expect(harness.providerHealth.get("allanime")).toBeDefined();
    expect(harness.stateManagerDispatch[0]).toContain("Cleared global provider failure memory");
  });

  test("applyProviderHealthResetScope clears anime lane providers", async () => {
    const harness = createResetContainer();
    const container = {
      ...harness,
      stateManager: {
        dispatch: () => {},
        getState: harness.stateManager.getState,
      },
    };

    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    const result = await applyProviderHealthResetScope(container as never, "anime-lane");
    expect(result.clearedGlobal).toBe(2);
    // SAFETY: literal ids satisfy the branded ProviderId in test fixtures.
    expect(harness.providerHealth.get("vidking" as ProviderId)).toBeDefined();
    // SAFETY: literal ids satisfy the branded ProviderId in test fixtures.
    expect(harness.providerHealth.get("youtube" as ProviderId)).toBeDefined();
  });

  test("applyProviderHealthResetScope series lane does not clear YouTube health", async () => {
    const harness = createResetContainer();
    const container = {
      ...harness,
      stateManager: {
        dispatch: () => {},
        getState: harness.stateManager.getState,
      },
    };

    // isAnimeProvider === false used to match YouTube too — a "series lane"
    // reset silently wiped the YouTube provider's health memory.
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    const result = await applyProviderHealthResetScope(container as never, "series-lane");
    expect(result.clearedGlobal).toBe(1);
    // SAFETY: literal ids satisfy the branded ProviderId in test fixtures.
    expect(harness.providerHealth.get("vidking" as ProviderId)).toBeUndefined();
    // SAFETY: literal ids satisfy the branded ProviderId in test fixtures.
    expect(harness.providerHealth.get("youtube" as ProviderId)).toBeDefined();
    // SAFETY: literal ids satisfy the branded ProviderId in test fixtures.
    expect(harness.providerHealth.get("miruro" as ProviderId)).toBeDefined();
  });

  test("applyProviderHealthResetScope clears title memory scopes", async () => {
    const harness = createResetContainer();
    const container = {
      ...harness,
      stateManager: {
        dispatch: () => {},
        getState: harness.stateManager.getState,
      },
    };

    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    await applyProviderHealthResetScope(container as never, "current-title");
    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    await applyProviderHealthResetScope(container as never, "current-title-provider");
    expect(harness.titleClears).toEqual(["mal:1", "mal:1:miruro"]);
  });

  test("reset scopes also clear endpoint quarantines for the same providers", async () => {
    const harness = createResetContainer();
    const container = {
      ...harness,
      stateManager: {
        dispatch: () => {},
        getState: harness.stateManager.getState,
      },
    };

    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    const current = await applyProviderHealthResetScope(container as never, "current-provider");
    expect(current.clearedEndpoints).toBe(1);
    expect(harness.endpointClears).toContain("provider:miruro");

    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    await applyProviderHealthResetScope(container as never, "current-title-provider");
    expect(harness.endpointClears).toContain("title:mal:1:miruro");

    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    const all = await applyProviderHealthResetScope(container as never, "all");
    expect(all.clearedEndpoints).toBe(2);
    expect(harness.endpointClears).toContain("__all__");
  });
});
