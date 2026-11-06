import { describe, expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../src/defaults";
import {
  isRetiredProductionProviderId,
  normalizeRetiredProductionProviderFields,
} from "../src/retired-production-providers";

describe("retired production providers", () => {
  test("anidb and videasy are retired from the live roster but remain known ids", () => {
    expect(isRetiredProductionProviderId("anidb")).toBe(true);
    expect(isRetiredProductionProviderId(" AniDB ")).toBe(true);
    expect(isRetiredProductionProviderId("videasy")).toBe(true);
    expect(isRetiredProductionProviderId(" Videasy ")).toBe(true);
    expect(isRetiredProductionProviderId("vidrock")).toBe(false);
    expect(isRetiredProductionProviderId("hianime")).toBe(false);
  });

  test("maps an explicit anime lane selection off a retired id", () => {
    const normalized = normalizeRetiredProductionProviderFields({
      animeProvider: "anidb",
      animeProviderPriority: ["kickassanime", "anidb", "miruro"],
      provider: DEFAULT_CONFIG.provider,
      providerPriority: [...DEFAULT_CONFIG.providerPriority],
      youtubeProvider: DEFAULT_CONFIG.youtubeProvider,
      youtubeProviderPriority: [...DEFAULT_CONFIG.youtubeProviderPriority],
      disabledProviders: [],
      titleProviderPreferences: {},
    });

    expect(normalized.animeProvider).toBe("hianime");
    expect(normalized.animeProviderPriority).toEqual(["kickassanime", "miruro"]);
  });

  test("maps an explicit series lane selection off a retired id", () => {
    const normalized = normalizeRetiredProductionProviderFields({
      animeProvider: DEFAULT_CONFIG.animeProvider,
      animeProviderPriority: [...DEFAULT_CONFIG.animeProviderPriority],
      provider: "videasy",
      providerPriority: ["rivestream", "videasy", "movy"],
      youtubeProvider: DEFAULT_CONFIG.youtubeProvider,
      youtubeProviderPriority: [...DEFAULT_CONFIG.youtubeProviderPriority],
      disabledProviders: [],
      titleProviderPreferences: {},
    });

    expect(normalized.provider).toBe("vidrock");
    expect(normalized.providerPriority).toEqual(["rivestream", "movy"]);
  });

  test("drops a retired id from disabledProviders without touching live providers", () => {
    const normalized = normalizeRetiredProductionProviderFields({
      animeProvider: DEFAULT_CONFIG.animeProvider,
      animeProviderPriority: [...DEFAULT_CONFIG.animeProviderPriority],
      provider: DEFAULT_CONFIG.provider,
      providerPriority: [...DEFAULT_CONFIG.providerPriority],
      youtubeProvider: DEFAULT_CONFIG.youtubeProvider,
      youtubeProviderPriority: [...DEFAULT_CONFIG.youtubeProviderPriority],
      disabledProviders: ["anidb", "miruro"],
      titleProviderPreferences: {},
    });

    expect(normalized.disabledProviders).toEqual(["miruro"]);
  });

  test("drops title pins that point at a retired provider", () => {
    const titleProviderPreferences: Record<string, string> = {
      "title-a": "anidb",
      "title-b": "allanime",
    };
    const normalized = normalizeRetiredProductionProviderFields({
      animeProvider: DEFAULT_CONFIG.animeProvider,
      animeProviderPriority: [...DEFAULT_CONFIG.animeProviderPriority],
      provider: DEFAULT_CONFIG.provider,
      providerPriority: [...DEFAULT_CONFIG.providerPriority],
      youtubeProvider: DEFAULT_CONFIG.youtubeProvider,
      youtubeProviderPriority: [...DEFAULT_CONFIG.youtubeProviderPriority],
      disabledProviders: [],
      titleProviderPreferences,
    });

    expect(normalized.titleProviderPreferences).toEqual({ "title-b": "allanime" });
  });
});
