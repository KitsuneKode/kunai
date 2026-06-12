import { describe, expect, test } from "bun:test";

import { applyUserProviderSwitch } from "@/app/playback-provider-switch";
import { createInitialState, reduceState } from "@/domain/session/SessionState";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

const config = {
  animeLanguageProfile: { audio: "original", subtitle: "en", quality: "auto" },
  seriesLanguageProfile: { audio: "original", subtitle: "none", quality: "auto" },
  movieLanguageProfile: { audio: "original", subtitle: "en", quality: "auto" },
  startupPriority: "balanced",
} as KitsuneConfig;

describe("playback provider switch", () => {
  test("SET_PROVIDER with forceFreshResolve clears stream and bumps providerSwitchSeq", () => {
    let state = createInitialState("vidking", "allanime", {
      anime: config.animeLanguageProfile,
      series: config.seriesLanguageProfile,
      movie: config.movieLanguageProfile,
    });
    state = reduceState(state, {
      type: "SET_STREAM",
      stream: { url: "https://example/stream.m3u8" } as never,
    });

    state = reduceState(state, {
      type: "SET_PROVIDER",
      provider: "rivestream",
      forceFreshResolve: true,
    });

    expect(state.provider).toBe("rivestream");
    expect(state.stream).toBeNull();
    expect(state.providerSwitchSeq).toBe(1);
  });

  test("applyUserProviderSwitch invalidates only the switched providers", async () => {
    const deletedProviders: string[] = [];
    const stateManager = {
      getState: () => ({
        mode: "series" as const,
        provider: "vidking",
      }),
      dispatch: (transition: { type: string; provider?: string; forceFreshResolve?: boolean }) => {
        if (transition.type === "SET_PROVIDER" && transition.provider) {
          currentProvider = transition.provider;
        }
      },
    };
    let currentProvider = "vidking";

    const configUpdates: Array<Partial<KitsuneConfig>> = [];
    const container = {
      stateManager,
      config: {
        getRaw: () => ({
          ...config,
          titleProviderPreferences: {},
          ...configUpdates.at(-1),
        }),
        update: async (partial: Partial<KitsuneConfig>) => {
          configUpdates.push(partial);
        },
        save: async () => {},
      },
      cacheStore: { delete: async () => {} },
      sourceInventory: {
        delete: async (input: { providerId: string }) => {
          deletedProviders.push(input.providerId);
        },
      },
      titleProviderHealth: { clear: () => {} },
      providerRegistry: {
        getCompatible: () => [
          { metadata: { id: "vidking" } },
          { metadata: { id: "rivestream" } },
          { metadata: { id: "vidlink" } },
        ],
      },
      diagnosticsService: { record: () => {} },
    } as never;

    await applyUserProviderSwitch({
      container,
      fromProviderId: "vidking",
      toProviderId: "rivestream",
      title: { id: "1396", type: "series", name: "Vincenzo" },
      episode: { season: 1, episode: 5 },
      mode: "series",
    });

    expect(currentProvider).toBe("rivestream");
    expect(deletedProviders.sort()).toEqual(["rivestream", "vidking"]);
    expect(configUpdates.at(-1)?.titleProviderPreferences).toEqual({
      "1396": "rivestream",
    });
  });
});
