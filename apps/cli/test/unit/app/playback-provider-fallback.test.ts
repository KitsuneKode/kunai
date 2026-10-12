import { describe, expect, test } from "bun:test";

import {
  pickCompatibleFallbackProvider,
  switchPlaybackProviderFallback,
} from "@/app/playback/playback-provider-fallback";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

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
      pickCompatibleFallbackProvider({
        providers: [{ metadata: { id: "vidking" } }, { metadata: { id: "rivestream" } }],
        currentProviderId: "vidking",
      })?.metadata.id,
    ).toBe("rivestream");
  });

  test("returns undefined when no alternate provider exists", () => {
    expect(
      pickCompatibleFallbackProvider({
        providers: [{ metadata: { id: "vidking" } }],
        currentProviderId: "vidking",
      }),
    ).toBeUndefined();
  });

  test("skips providers already tried this cycle instead of ping-ponging", () => {
    expect(
      pickCompatibleFallbackProvider({
        providers: [
          { metadata: { id: "vidking" } },
          { metadata: { id: "rivestream" } },
          { metadata: { id: "allmanga" } },
        ],
        currentProviderId: "allmanga",
        excludedProviderIds: new Set(["vidking", "allmanga"]),
      })?.metadata.id,
    ).toBe("rivestream");
  });

  test("skips health-gated providers when an eligibility gate is given", () => {
    expect(
      pickCompatibleFallbackProvider({
        providers: [
          { metadata: { id: "vidking" } },
          { metadata: { id: "rivestream" } },
          { metadata: { id: "allmanga" } },
        ],
        currentProviderId: "vidking",
        isFallbackEligible: (id) => id !== "rivestream",
      })?.metadata.id,
    ).toBe("allmanga");
  });

  test("returns undefined when every alternate is tried or ineligible", () => {
    expect(
      pickCompatibleFallbackProvider({
        providers: [
          { metadata: { id: "vidking" } },
          { metadata: { id: "rivestream" } },
          { metadata: { id: "allmanga" } },
        ],
        currentProviderId: "vidking",
        excludedProviderIds: new Set(["rivestream"]),
        isFallbackEligible: (id) => id !== "allmanga",
      }),
    ).toBeUndefined();
  });

  test("applies a session-scoped switch without persisting a per-title preference", async () => {
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
        getManifest: () => undefined,
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
    // ⇧F is a recovery hop, not a durable per-title preference — the explicit
    // provider picker remains the only path that writes one.
    expect(configUpdates).toEqual([]);
    expect(sourceInventoryDeletes.sort()).toEqual(["rivestream", "vidking"]);
    expect(invalidatedEpisodes).toEqual(["1:2"]);
  });
});
