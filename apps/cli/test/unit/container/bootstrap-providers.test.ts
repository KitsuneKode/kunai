import { describe, expect, test } from "bun:test";

import { loadProductionProviderModules } from "@/container/bootstrap-providers";
import { isAnimeOnlyProviderId } from "@/domain/media/content-kind";
import { RELAY_CAPABLE_PROVIDER_OPTIONS } from "@/domain/provider-relay-settings";
import { createProviderPrioritySnapshot } from "@/services/providers/provider-priority";
import { DEFAULT_CONFIG } from "@kunai/config";

import { PROBES as STATUS_SWEEP_PROBES } from "../../../../../packages/providers/scripts/provider-status-sweep.ts";

describe("production provider defaults", () => {
  test("every configured lane default is a registered production module", async () => {
    const modules = await loadProductionProviderModules(
      createProviderPrioritySnapshot(DEFAULT_CONFIG),
    );
    const ids = modules.map((module) => module.providerId);

    expect(DEFAULT_CONFIG.provider).toBe("vidlink");
    // The anime lane default must be a provider that answers. AniDB stays
    // registered in the priority tail; it is not first, because search only
    // queries the configured default and anidb.app answers 503 at the origin.
    expect(DEFAULT_CONFIG.animeProvider).toBe("hianime");
    expect(ids).toContain(DEFAULT_CONFIG.provider);
    expect(ids).toContain(DEFAULT_CONFIG.animeProvider);
    expect(ids).toContain(DEFAULT_CONFIG.youtubeProvider);
    // Every name in a default priority list must be a live module; ordering an
    // unregistered id is a silent no-op that nothing would ever report.
    for (const id of DEFAULT_CONFIG.animeProviderPriority) expect(ids).toContain(id);
    for (const id of DEFAULT_CONFIG.providerPriority) expect(ids).toContain(id);
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
      "movy",
      "rivestream",
      "videasy",
      "vidlink",
      "vidrock",
      "youtube",
    ]);
  });

  test("the status sweep probes every production module — an unprobed provider is invisible", async () => {
    const modules = await loadProductionProviderModules(
      createProviderPrioritySnapshot(DEFAULT_CONFIG),
    );
    const probed = STATUS_SWEEP_PROBES.map((probe) => probe.id).sort();
    const registered = modules.map((module) => module.providerId).sort();
    // The sweep sat at 8 of 12 probes while vidrock, movy, animegg and
    // kickassanime shipped — the board could not see them. This pin makes a
    // missing probe row a test failure instead of a silent gap.
    expect(probed).toEqual(registered);
  });

  test("the relay settings list covers every production provider that declares relayProfile", async () => {
    const modules = await loadProductionProviderModules(
      createProviderPrioritySnapshot(DEFAULT_CONFIG),
    );
    // A hand-maintained list drifted once: hianime was relay-routed by default
    // yet missing from Settings, so the user had no way to switch it off and
    // the "all relay-capable" summary line lied (#460). Derive the expectation
    // from the roster so a new relay-capable provider fails loudly here.
    // SAFETY: providerId is branded; widen to string for the plain-string comparison list.
    const expected = modules
      .filter((module) => module.manifest.relayProfile !== undefined)
      .map((module) => module.providerId as string)
      .sort();

    // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
    expect(RELAY_CAPABLE_PROVIDER_OPTIONS.map((option) => option.value as string).sort()).toEqual(
      expected,
    );
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
        // SAFETY: deliberately partial test stub — the test only exercises the members it defines.
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

describe("anime-only provider ids", () => {
  test("match every production module whose manifest serves only anime", async () => {
    // History stamps a title "anime" from its provider when no AniList/MAL id
    // resolved. A hand list that missed hianime/animegg/kickassanime/anidb
    // mis-stamped those plays "series" — so pin it to the manifests.
    const modules = await loadProductionProviderModules(
      createProviderPrioritySnapshot(DEFAULT_CONFIG),
    );
    const animeOnly = modules
      .filter(
        (module) =>
          module.manifest.mediaKinds.length > 0 &&
          module.manifest.mediaKinds.every((kind) => kind === "anime"),
      )
      .map((module) => module.providerId)
      .sort();

    expect(
      animeOnly.filter((id) => !isAnimeOnlyProviderId(id)),
      "anime-only manifest missing from ANIME_ONLY_PROVIDER_IDS",
    ).toEqual([]);
    expect(
      modules
        .map((module) => module.providerId)
        .filter(isAnimeOnlyProviderId)
        .sort(),
    ).toEqual(animeOnly);
  });
});
