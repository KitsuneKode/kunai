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
  expect(episodes?.[0]?.label).toBe("Episode 1");
  expect(searchSignals).toEqual([controller.signal]);
  expect(listSignals).toEqual([controller.signal]);
});
