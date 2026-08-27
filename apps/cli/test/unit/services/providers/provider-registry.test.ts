import { expect, test } from "bun:test";

import { episodeInfoFromSelection } from "@/app/bootstrap/episode-info-from-catalog";
import { ProviderRegistryImpl } from "@/services/providers/ProviderRegistry";
import { streamRequestToResolveInput } from "@/services/providers/stream-request-adapter";
import {
  createProviderEngine,
  defineProviderManifest,
  type CoreProviderModule,
  type ProviderEngine,
} from "@kunai/core";
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
  let searchShape: string | undefined;
  const module: CoreProviderModule = {
    providerId: "hooked",
    manifest,
    async resolve() {
      throw new Error("resolve should not be called");
    },
    async search(input, context): Promise<ProviderSearchResult[]> {
      searchShape = input.preferredContentShape;
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
    createRuntimeContext: (_providerId: string, signal?: AbortSignal) => ({
      providerId: "hooked",
      now: () => new Date().toISOString(),
      signal,
    }),
  } as unknown as ProviderEngine);
  const provider = registry.get("hooked");
  const controller = new AbortController();

  const results = await provider?.search?.(
    "hook",
    { audioPreference: "original", subtitlePreference: "en", contentShape: "short" },
    controller.signal,
  );
  const episodes = await provider?.listEpisodes?.(
    { title: { id: "anime-1", type: "series", name: "Hooked Anime" } },
    controller.signal,
  );

  expect(results?.[0]?.title).toBe("Hooked Anime");
  expect(searchShape).toBe("short");
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
    createModule("videasy", ["movie", "series"]),
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
    "videasy",
    "vidlink",
    "rivestream",
  ]);
  expect(animeProviders.map((provider) => provider.metadata.id)).toEqual(["miruro", "allanime"]);
  expect(registry.getDefault(false).metadata.id).toBe("videasy");
  expect(registry.getDefault(true).metadata.id).toBe("miruro");

  registry.setPriority({
    providerPriority: ["rivestream", "vidlink"],
    animeProviderPriority: ["allanime", "miruro"],
  });

  expect(
    registry
      .getCompatible({ id: "movie:1", type: "movie", name: "Movie" }, "series")
      .map((provider) => provider.metadata.id),
  ).toEqual(["rivestream", "vidlink", "videasy"]);
  expect(registry.getDefault(false).metadata.id).toBe("rivestream");
  expect(registry.getDefault(true).metadata.id).toBe("allanime");
});

test("listEpisodes receives the full title identity and language preferences", async () => {
  // Regression: the adapter used to hand-roll `{id, kind, title}`, dropping
  // externalIds/anilistId/tmdbId — so AllAnime's AniList->native bridge and
  // Miruro's numeric-id lookup had nothing to read, and episode listing worked
  // only when the raw session id happened to already be native. It also never
  // passed language preferences, so dub users got the sub catalogue.
  let received: Record<string, unknown> | null = null;
  const module: CoreProviderModule = {
    providerId: "hooked",
    manifest,
    async resolve() {
      throw new Error("resolve should not be called");
    },
    async listEpisodes(input): Promise<ProviderEpisodeOption[]> {
      received = input as unknown as Record<string, unknown>;
      return [
        {
          index: 1,
          label: "Episode 1 · Pilot",
          name: "Pilot",
          detail: "The first episode",
          release: { airDate: "2026-01-02" },
          artwork: { thumbnailUrl: "https://img.example/episode-1.jpg" },
          totalEpisodeCount: 1,
        },
      ];
    },
  };

  const engine = {
    modules: [module],
    getManifest: () => manifest,
    getProviderIds: () => ["hooked"],
    createRuntimeContext: () => ({ now: () => Date.now() }),
  } as unknown as ProviderEngine;

  const registry = new ProviderRegistryImpl(engine);
  const episodes = await registry.get("hooked")?.listEpisodes?.({
    title: {
      id: "anilist:21",
      name: "One Piece",
      type: "series",
      externalIds: { anilistId: "21", malId: "21" },
    } as never,
    audioPreference: "dub",
    subtitlePreference: "en",
  });

  const title = (received as unknown as { title: Record<string, unknown> }).title;
  expect(title.externalIds).toEqual({ anilistId: "21", malId: "21" });
  expect(title.title).toBe("One Piece");
  expect((received as unknown as Record<string, unknown>).preferredAudioLanguage).toBe("dub");
  expect((received as unknown as Record<string, unknown>).preferredSubtitleLanguage).toBe("en");
  expect(episodes?.[0]).toMatchObject({
    name: "Pilot",
    detail: "The first episode",
    overview: "The first episode",
    airDate: "2026-01-02",
    release: { airDate: "2026-01-02" },
    previewImageUrl: "https://img.example/episode-1.jpg",
    artwork: { thumbnailUrl: "https://img.example/episode-1.jpg" },
  });
});

test("provider episode identity survives the catalog adapter and selected resolve request", async () => {
  const module: CoreProviderModule = {
    providerId: "hooked",
    manifest,
    async resolve() {
      throw new Error("resolve should not be called");
    },
    async listEpisodes(): Promise<ProviderEpisodeOption[]> {
      return [
        {
          index: 1,
          label: "Episode 0",
          detail: "0",
          providerEpisodeIdentity: { providerId: "hooked", value: "0" },
        },
      ];
    },
  };
  const engine = createProviderEngine({ modules: [module] });
  const registry = new ProviderRegistryImpl(engine);
  const title = { id: "native-show", name: "Native Show", type: "series" as const };

  const episodes = await registry.get("hooked")?.listEpisodes?.({ title });
  const selected = episodeInfoFromSelection({
    season: 1,
    episode: 1,
    isAnime: true,
    titleId: title.id,
    animeEpisodes: episodes ?? undefined,
  });
  const input = streamRequestToResolveInput(
    {
      title,
      episode: selected,
      audioPreference: "original",
      subtitlePreference: "en",
    },
    "anime",
    "play",
    "provider-native",
    "hooked",
  );

  expect(episodes?.[0]?.providerEpisodeIdentity).toEqual({ providerId: "hooked", value: "0" });
  expect(input.episode).toMatchObject({
    episode: 1,
    providerEpisodeIdentity: { providerId: "hooked", value: "0" },
  });
});
