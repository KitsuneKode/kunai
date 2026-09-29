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

  test("the production roster is pinned — adding a module fails loudly here", async () => {
    const modules = await loadProductionProviderModules(
      createProviderPrioritySnapshot(DEFAULT_CONFIG),
    );
    // Reverse-parity pin: a provider registered here but absent from coverage
    // lists elsewhere (as happened to hianime in the resolve-gate coverage
    // test) is invisible. Every roster change is a deliberate edit of this list.
    // The allmanga module registers as "allanime" — its historical id, kept
    // so existing configs and cache keys keep resolving.
    expect(modules.map((module) => module.providerId).sort()).toEqual([
      "allanime",
      "anidb",
      "animegg",
      "hianime",
      "kickassanime",
      "miruro",
      "rivestream",
      "videasy",
      "vidlink",
      "youtube",
    ]);
  });

  test("every declared capability has a runtime operation that implements it", async () => {
    const modules = await loadProductionProviderModules(
      createProviderPrioritySnapshot(DEFAULT_CONFIG),
    );
    // Capability names and runtime-operation names are different vocabularies
    // on purpose; this is the map. Capabilities absent from it (multi-source,
    // quality-ranked) describe behavior, not operations, and are exempt.
    const operationForCapability = {
      search: "search",
      "episode-list": "list-episodes",
      "source-resolve": "resolve-stream",
      "subtitle-resolve": "resolve-subtitles",
    } as const;

    for (const module of modules) {
      const operations = new Set(module.manifest.runtimePorts.flatMap((port) => port.operations));
      for (const capability of module.manifest.capabilities) {
        const operation = operationForCapability[capability as keyof typeof operationForCapability];
        if (!operation) continue;
        expect(
          operations.has(operation),
          `${module.providerId} declares "${capability}" but no runtime port implements "${operation}"`,
        ).toBe(true);
      }
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
