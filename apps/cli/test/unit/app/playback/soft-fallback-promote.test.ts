import { describe, expect, test } from "bun:test";

import { promoteSoftFallbackAfterEngage } from "@/app/playback/playback-provider-switch";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

function makeContainer(initialPrefs: KitsuneConfig["titleProviderPreferences"] = {}) {
  let prefs = { ...initialPrefs };
  return {
    config: {
      getRaw: () => ({ titleProviderPreferences: prefs }) as KitsuneConfig,
      update: async (partial: Partial<KitsuneConfig>) => {
        if (partial.titleProviderPreferences) {
          prefs = partial.titleProviderPreferences;
        }
      },
      save: async () => {},
    },
    getPrefs: () => prefs,
  };
}

const title = {
  id: "anilist:1",
  type: "series" as const,
  isAnime: true,
};

describe("soft fallback promote after engage", () => {
  test("soft hop before engage does not persist title preference", async () => {
    const container = makeContainer();

    await promoteSoftFallbackAfterEngage(container as never, {
      title,
      mode: "anime",
      sessionSoftProviderId: "miruro",
      configuredProviderId: "allanime",
      engaged: false,
    });

    expect(container.getPrefs()).toEqual({});
  });

  test("engage after soft hop promotes durable preference", async () => {
    const container = makeContainer();

    await promoteSoftFallbackAfterEngage(container as never, {
      title,
      mode: "anime",
      sessionSoftProviderId: "miruro",
      configuredProviderId: "allanime",
      engaged: true,
    });

    expect(container.getPrefs()).toEqual({ "anilist:1": "miruro" });
  });
});
