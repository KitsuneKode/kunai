import { expect, test } from "bun:test";

import { languageProfileForLane, providerForLane } from "@/app/bootstrap/lane-settings-sync";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

function baseConfig(): KitsuneConfig {
  return {
    provider: "vidking",
    animeProvider: "allanime",
    youtubeProvider: "youtube",
    defaultMode: "series",
    seriesLanguageProfile: { audio: "original", subtitle: "en" },
    animeLanguageProfile: { audio: "ja", subtitle: "en" },
    movieLanguageProfile: { audio: "original", subtitle: "en" },
    youtubeLanguageProfile: { audio: "original", subtitle: "en", quality: "1080p" },
  } as KitsuneConfig;
}

test("providerForLane returns lane-specific defaults", () => {
  const config = baseConfig();

  expect(providerForLane(config, "series")).toBe("vidking");
  expect(providerForLane(config, "anime")).toBe("allanime");
  expect(providerForLane(config, "youtube")).toBe("youtube");
});

test("languageProfileForLane returns lane-specific profiles", () => {
  const config = baseConfig();

  expect(languageProfileForLane(config, "youtube").quality).toBe("1080p");
  expect(languageProfileForLane(config, "anime").audio).toBe("ja");
  expect(languageProfileForLane(config, "series").subtitle).toBe("en");
});
