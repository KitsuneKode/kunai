import { expect, test } from "bun:test";

import { ProviderRegistryImpl } from "@/services/providers/ProviderRegistry";
import { defineProviderManifest, type CoreProviderModule, type ProviderEngine } from "@kunai/core";
import type { ProviderEpisodeOption, ProviderSearchResult } from "@kunai/types";

const manifest = defineProviderManifest({
  id: "hooked",
  displayName: "Hooked",
  description: "Test provider with app-facing hooks",
  domain: "hooked.example",
  recommended: true,
  mediaKinds: ["anime"],
  capabilities: ["search", "episode-list", "source-resolve"],
  runtimePorts: [],
  cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: ["provider"] },
  browserSafe: true,
  relaySafe: true,
  status: "candidate",
});

function createManifestFor(id: string, mediaKinds: readonly ("anime" | "movie" | "series")[]) {
  return defineProviderManifest({
    id,
    displayName: id,
    description: id,
    domain: `${id}.example`,
    recommended: true,
    mediaKinds,
    capabilities: ["source-resolve"],
    runtimePorts: [],
    cachePolicy: { ttlClass: "stream-manifest", scope: "local", keyParts: ["provider"] },
    browserSafe: true,
    relaySafe: true,
    status: "candidate",
  });
}

function createModule(id: string, mediaKinds: readonly ("anime" | "movie" | "series")[]) {
  const providerManifest = createManifestFor(id, mediaKinds);
  return {
    providerId: id,
    manifest: providerManifest,
    async resolve() {
      throw new Error("resolve should not be called");
    },
  } satisfies CoreProviderModule;
}

test("ProviderRegistry wires provider-owned search and episode hooks without provider id checks", async () => {
  const searchSignals: AbortSignal[] = [];
  const listSignals: AbortSignal[] = [];
  const module: CoreProviderModule = {
    providerId: "hooked",
    manifest,
    async resolve() {
      throw new Error("resolve should not be called");
    },
    async search(input, context): Promise<ProviderSearchResult[]> {
      if (context.signal) searchSignals.push(context.signal);
      return [
        {
          id: "anime-1",
          type: "series",
          title: "Hooked Anime",
          year: "2026",
          overview: "Provider-owned search result",
          posterPath: "https://img.example/poster.jpg",
          metadataSource: "Hooked",
          availableAudioModes: ["sub"],
          subtitleAvailability: "hardsub",
          externalIds: { anilistId: "123", malId: "456" },
          release: {
            availableAt: "2026-05-19T12:30:00.000Z",
            status: "released",
            providerConfirmed: true,
          },
          artwork: {
            posterUrl: "https://img.example/poster.jpg",
            seekBarVttUrl: "https://img.example/seek.vtt",
          },
          languageEvidence: [
            {
              role: "hardsub",
              normalizedLanguage: "en",
              nativeLabel: "Hard Sub",
              confidence: 0.9,
            },
          ],
        },
      ];
    },
    async listEpisodes(_input, context): Promise<ProviderEpisodeOption[]> {
      if (context.signal) listSignals.push(context.signal);
      return [{ index: 1, label: "Episode 1", totalEpisodeCount: 1 }];
    },
  };
  const registry = new ProviderRegistryImpl({
    modules: [module],
    getProviderIds: () => ["hooked"],
    getManifest: () => manifest,
  } as unknown as ProviderEngine);
  const provider = registry.get("hooked");
  const controller = new AbortController();

  const results = await provider?.search?.(
    "hook",
    { audioPreference: "original", subtitlePreference: "en" },
    controller.signal,
  );
  const episodes = await provider?.listEpisodes?.(
    { title: { id: "anime-1", type: "series", name: "Hooked Anime" } },
    controller.signal,
  );

  expect(results?.[0]?.title).toBe("Hooked Anime");
  expect(results?.[0]?.externalIds?.malId).toBe("456");
  expect(results?.[0]?.release?.providerConfirmed).toBe(true);
  expect(results?.[0]?.artwork?.seekBarVttUrl).toContain("seek.vtt");
  expect(results?.[0]?.languageEvidence?.[0]?.nativeLabel).toBe("Hard Sub");
  expect(episodes?.[0]?.label).toBe("Episode 1");
  expect(searchSignals).toEqual([controller.signal]);
  expect(listSignals).toEqual([controller.signal]);
});

test("ProviderRegistry sorts compatible providers by configured priority", () => {
  const modules = [
    createModule("vidlink", ["movie", "series"]),
    createModule("rivestream", ["movie", "series"]),
    createModule("vidking", ["movie", "series"]),
    createModule("allanime", ["anime"]),
    createModule("miruro", ["anime"]),
  ];
  const registry = new ProviderRegistryImpl(
    {
      modules,
      getProviderIds: () => modules.map((module) => module.providerId),
      getManifest: (id: string) => modules.find((module) => module.providerId === id)?.manifest,
    } as unknown as ProviderEngine,
    {
      providerPriority: ["vidking", "vidlink"],
      animeProviderPriority: ["miruro", "allanime"],
    },
  );

  const seriesProviders = registry.getCompatible(
    { id: "movie:1", type: "movie", name: "Movie" },
    "series",
  );
  const animeProviders = registry.getCompatible(
    { id: "anime:1", type: "series", name: "Anime" },
    "anime",
  );

  expect(seriesProviders.map((provider) => provider.metadata.id)).toEqual([
    "vidking",
    "vidlink",
    "rivestream",
  ]);
  expect(animeProviders.map((provider) => provider.metadata.id)).toEqual(["miruro", "allanime"]);
  expect(registry.getDefault(false).metadata.id).toBe("vidking");
  expect(registry.getDefault(true).metadata.id).toBe("miruro");
});
