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
    expect(DEFAULT_CONFIG.animeProvider).toBe("miruro");
    expect(ids).toContain(DEFAULT_CONFIG.provider);
    expect(ids).toContain(DEFAULT_CONFIG.animeProvider);
    expect(ids).toContain(DEFAULT_CONFIG.youtubeProvider);
    // Every name in a default priority list must be a live module; ordering an
    // unregistered id is a silent no-op that nothing would ever report.
    for (const id of DEFAULT_CONFIG.animeProviderPriority) expect(ids).toContain(id);
    for (const id of DEFAULT_CONFIG.providerPriority) expect(ids).toContain(id);

    // A lane default renders with a "· candidate" suffix in the picker if its
    // manifest says so, which is the wrong thing to show on the one provider
    // most users never change.
    for (const laneDefault of [
      DEFAULT_CONFIG.provider,
      DEFAULT_CONFIG.animeProvider,
      DEFAULT_CONFIG.youtubeProvider,
    ]) {
      const module = modules.find((candidate) => candidate.providerId === laneDefault);
      expect(module?.manifest.status).toBe("production");
    }
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
