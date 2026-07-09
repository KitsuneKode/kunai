import { describe, expect, test } from "bun:test";

import {
  pickCompatibleFallbackProvider,
  switchPlaybackProviderFallback,
} from "@/app/playback/playback-provider-fallback";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import type { ProviderHealth, ProviderId } from "@kunai/types";

const config = {
  animeLanguageProfile: { audio: "original", subtitle: "en", quality: "auto" },
  seriesLanguageProfile: { audio: "original", subtitle: "none", quality: "auto" },
  movieLanguageProfile: { audio: "original", subtitle: "en", quality: "auto" },
  startupPriority: "balanced",
  titleProviderPreferences: {},
} as KitsuneConfig;

const providers = [
  { metadata: { id: "vidking" } },
  { metadata: { id: "rivestream" } },
  { metadata: { id: "miruro" } },
];

function health(
  providerId: string,
  status: ProviderHealth["status"],
  checkedAt = new Date().toISOString(),
): ProviderHealth {
  return {
    providerId: providerId as ProviderId,
    status,
    checkedAt,
  };
}

describe("playback provider fallback", () => {
  test("picks the first compatible provider that is not current", () => {
    expect(pickCompatibleFallbackProvider(providers, "vidking")?.metadata.id).toBe("rivestream");
  });

  test("returns undefined when no alternate provider exists", () => {
    expect(
      pickCompatibleFallbackProvider([{ metadata: { id: "vidking" } }], "vidking"),
    ).toBeUndefined();
  });

  test("skips unhealthy providers when health data is available", () => {
    const healthById = new Map<string, ProviderHealth>([
      ["rivestream", health("rivestream", "down")],
      ["miruro", health("miruro", "healthy")],
    ]);

    expect(
      pickCompatibleFallbackProvider(providers, "vidking", {
        getProviderHealth: (providerId) => healthById.get(providerId),
      })?.metadata.id,
    ).toBe("miruro");
  });

  test("prefers a title-health suggestion when that provider is eligible", () => {
    expect(
      pickCompatibleFallbackProvider(providers, "vidking", {
        suggestedProviderId: "miruro",
        getProviderHealth: () => undefined,
      })?.metadata.id,
    ).toBe("miruro");
  });

  test("falls back to first alternate when all candidates are down", () => {
    const healthById = new Map<string, ProviderHealth>([
      ["rivestream", health("rivestream", "down")],
      ["miruro", health("miruro", "down")],
    ]);

    expect(
      pickCompatibleFallbackProvider(providers, "vidking", {
        getProviderHealth: (providerId) => healthById.get(providerId),
      })?.metadata.id,
    ).toBe("rivestream");
  });

  test("still prefers a title-health suggestion when every alternate is down", () => {
    const healthById = new Map<string, ProviderHealth>([
      ["rivestream", health("rivestream", "down")],
      ["miruro", health("miruro", "down")],
    ]);

    expect(
      pickCompatibleFallbackProvider(providers, "vidking", {
        getProviderHealth: (providerId) => healthById.get(providerId),
        suggestedProviderId: "miruro",
      })?.metadata.id,
    ).toBe("miruro");
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
