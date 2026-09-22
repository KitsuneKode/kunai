import { describe, expect, test } from "bun:test";

import {
  pickCompatibleFallbackProvider,
  providerFallbackEligibility,
  switchPlaybackProviderFallback,
} from "@/app/playback/playback-provider-fallback";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import type { ProviderId } from "@kunai/types";

const config = {
  animeLanguageProfile: { audio: "original", subtitle: "en", quality: "auto" },
  seriesLanguageProfile: { audio: "original", subtitle: "none", quality: "auto" },
  movieLanguageProfile: { audio: "original", subtitle: "en", quality: "auto" },
  startupPriority: "balanced",
  titleProviderPreferences: {},
} as KitsuneConfig;

describe("playback provider fallback", () => {
  test("picks the first compatible provider that is not current", () => {
    expect(
      pickCompatibleFallbackProvider(
        [{ metadata: { id: "vidking" } }, { metadata: { id: "rivestream" } }],
        "vidking",
      )?.metadata.id,
    ).toBe("rivestream");
  });

  test("returns undefined when no alternate provider exists", () => {
    expect(
      pickCompatibleFallbackProvider([{ metadata: { id: "vidking" } }], "vidking"),
    ).toBeUndefined();
  });

  test("skips a down provider and lands on the next healthy compatible one", () => {
    const eligibility = providerFallbackEligibility({
      get: (providerId: ProviderId) =>
        providerId === "videasy"
          ? {
              providerId,
              status: "down" as const,
              checkedAt: new Date().toISOString(),
              consecutiveFailures: 9,
            }
          : undefined,
    } as never);
    expect(
      pickCompatibleFallbackProvider(
        [
          { metadata: { id: "vidlink" } },
          { metadata: { id: "videasy" } },
          { metadata: { id: "rivestream" } },
        ],
        "vidlink",
        eligibility,
      )?.metadata.id,
    ).toBe("rivestream");
  });

  test("treats unknown health as eligible — absence of a row is no evidence", () => {
    const eligibility = providerFallbackEligibility({ get: () => undefined } as never);
    expect(
      pickCompatibleFallbackProvider(
        [{ metadata: { id: "vidlink" } }, { metadata: { id: "rivestream" } }],
        "vidlink",
        eligibility,
      )?.metadata.id,
    ).toBe("rivestream");
  });

  test("keeps a degraded provider eligible — it still resolves", () => {
    const eligibility = providerFallbackEligibility({
      get: () =>
        ({
          providerId: "rivestream",
          status: "degraded" as const,
          checkedAt: new Date().toISOString(),
          consecutiveFailures: 3,
        }) as never,
    } as never);
    expect(
      pickCompatibleFallbackProvider(
        [{ metadata: { id: "vidlink" } }, { metadata: { id: "rivestream" } }],
        "vidlink",
        eligibility,
      )?.metadata.id,
    ).toBe("rivestream");
  });

  test("switches provider through the shared user-switch path and invalidates recent stream", async () => {
    const dispatches: unknown[] = [];
    const invalidatedEpisodes: string[] = [];
    const sourceInventoryDeletes: string[] = [];
    const configUpdates: Array<Partial<KitsuneConfig>> = [];

    const container = {
      stateManager: {
        getState: () => ({ mode: "series", provider: "vidking" }),
        dispatch: (transition: unknown) => dispatches.push(transition),
      },
      config: {
        getRaw: () => ({ ...config, ...configUpdates.at(-1) }),
        update: async (partial: Partial<KitsuneConfig>) => {
          configUpdates.push(partial);
        },
        save: async () => {},
      },
      cacheStore: { delete: async () => {} },
      sourceInventory: {
        delete: async (input: { providerId: string }) => {
          sourceInventoryDeletes.push(input.providerId);
        },
      },
      titleProviderHealth: { clear: () => {} },
      providerRegistry: {
        getCompatible: () => [{ metadata: { id: "vidking" } }, { metadata: { id: "rivestream" } }],
      },
      diagnosticsService: { record: () => {} },
    } as never;

    const result = await switchPlaybackProviderFallback({
      container,
      fromProviderId: "vidking",
      toProviderId: "rivestream",
      title: { id: "1396", type: "series", name: "Vincenzo" },
      episode: { season: 1, episode: 2 },
      mode: "series",
      invalidateRecentEpisodeStream: (episode) => {
        invalidatedEpisodes.push(`${episode.season}:${episode.episode}`);
      },
    });

    expect(result).toEqual({ fromProviderId: "vidking", providerId: "rivestream" });
    expect(dispatches).toContainEqual({
      type: "SET_PROVIDER",
      provider: "rivestream",
      forceFreshResolve: true,
    });
    expect(configUpdates.at(-1)?.titleProviderPreferences).toEqual({ "1396": "rivestream" });
    expect(sourceInventoryDeletes.sort()).toEqual(["rivestream", "vidking"]);
    expect(invalidatedEpisodes).toEqual(["1:2"]);
  });
});
