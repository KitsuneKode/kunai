import { describe, expect, test } from "bun:test";

import { loadProductionProviderModules } from "@/container/bootstrap-providers";
import { createProviderPrioritySnapshot } from "@/services/providers/provider-priority";
import { DEFAULT_CONFIG } from "@kunai/config";

describe("production provider defaults", () => {
  test("every configured lane default is a registered production module", async () => {
    const modules = await loadProductionProviderModules(
      createProviderPrioritySnapshot(DEFAULT_CONFIG),
    );
    const ids = modules.map((module) => module.providerId);

    expect(DEFAULT_CONFIG.provider).toBe("videasy");
    // The anime lane default must be a provider that answers. AniDB stays
    // registered and second in `animeProviderPriority`; it is not first,
    // because search only queries the configured default and anidb.app
    // answers 503 at the origin.
    expect(DEFAULT_CONFIG.animeProvider).toBe("hianime");
    expect(ids).toContain(DEFAULT_CONFIG.provider);
    expect(ids).toContain(DEFAULT_CONFIG.animeProvider);
    expect(ids).toContain(DEFAULT_CONFIG.youtubeProvider);
  });

  test("every production source resolver keys the full request identity", async () => {
    const modules = await loadProductionProviderModules(
      createProviderPrioritySnapshot(DEFAULT_CONFIG),
    );
    const preferenceTokens = [
      "audio",
      "subtitle",
      "quality",
      "startup",
      "source",
      "stream",
    ] as const;

    for (const module of modules.filter(({ manifest }) =>
      manifest.capabilities.includes("source-resolve"),
    )) {
      const { keyParts } = module.manifest.cachePolicy;
      expect(keyParts).toContain("provider");
      expect(keyParts).toContain(module.providerId);
      expect(keyParts).toContain("title");
      for (const token of preferenceTokens) {
        expect(keyParts).toContain(token);
      }

      if (module.manifest.mediaKinds.some((kind) => kind !== "video")) {
        expect(keyParts).toContain("episode");
      }
    }
  });
});
