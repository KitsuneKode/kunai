import { describe, expect, test } from "bun:test";

import {
  buildSourceInventoryCacheInput,
  invalidateEpisodePlaybackCaches,
} from "@/app/playback/playback-source-cache-invalidation";
import { loadProductionProviderModules } from "@/container/bootstrap-providers";
import { buildApiStreamResolveCacheKey } from "@/services/cache/stream-resolve-cache";
import type { CacheStore } from "@/services/persistence/CacheStore";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import type { ProviderEpisodeIdentity } from "@kunai/types";

const config = {
  animeLanguageProfile: { audio: "original", subtitle: "en", quality: "auto" },
  seriesLanguageProfile: { audio: "original", subtitle: "none", quality: "720p" },
  movieLanguageProfile: { audio: "original", subtitle: "en", quality: "auto" },
  startupPriority: "balanced",
} as KitsuneConfig;

function cacheStoreWithDelete(deleteEntry: CacheStore["delete"]): CacheStore {
  return {
    ttl: 60_000,
    get: async () => null,
    set: async () => {},
    delete: deleteEntry,
    clear: async () => {},
    prune: async () => {},
  };
}

describe("playback-source-cache-invalidation", () => {
  test("recovery removes the writer's base and pinned keys for every production manifest", async () => {
    const modules = await loadProductionProviderModules({
      providerPriority: [],
      animeProviderPriority: [],
    });
    for (const module of modules) {
      const anime = module.manifest.mediaKinds.includes("anime");
      const input = {
        providerId: module.providerId,
        providerManifest: module.manifest,
        title: { id: anime ? "anilist:1" : "1396", type: "series", name: "Recovery" },
        episode: { season: 2, episode: 5 },
        mode: anime ? "anime" : "series",
        config,
        selectedSourceId: "source:mirror",
        selectedStreamId: "stream:mirror:720",
      } as const;
      const keyInput = {
        ...input,
        audioPreference: "original",
        subtitlePreference: anime ? "en" : "none",
        qualityPreference: anime ? "auto" : "720p",
        startupPriority: config.startupPriority,
      };
      const stored = new Set([
        buildApiStreamResolveCacheKey({
          ...keyInput,
          selectedSourceId: undefined,
          selectedStreamId: undefined,
        }),
        buildApiStreamResolveCacheKey(keyInput),
        "unrelated-title",
      ]);
      await invalidateEpisodePlaybackCaches({
        ...input,
        cacheStore: cacheStoreWithDelete(async (key) => {
          stored.delete(key);
        }),
        sourceInventory: { delete: async () => {} },
      });
      expect([...stored], module.providerId).toEqual(["unrelated-title"]);
    }
  });

  test("buildSourceInventoryCacheInput maps series mode from title type", () => {
    const inventoryInput = buildSourceInventoryCacheInput(
      "vidking",
      { id: "1396", type: "series", name: "Breaking Bad" },
      { season: 1, episode: 5 },
      "series",
      config,
    );
    expect(inventoryInput).toEqual(
      expect.objectContaining({
        providerId: "vidking",
        mediaKind: "series",
        titleId: "1396",
        season: 1,
        episode: 5,
        qualityPreference: "720p",
      }),
    );
  });

  test("buildSourceInventoryCacheInput retains the exact provider-native episode identity", () => {
    const inventoryInput = buildSourceInventoryCacheInput(
      "allanime",
      { id: "anilist:1", type: "series", name: "Native Anime" },
      {
        season: 1,
        episode: 1,
        providerEpisodeIdentity: { providerId: "allanime", value: "0" },
      },
      "anime",
      config,
    );

    expect(inventoryInput).toMatchObject({
      providerEpisodeIdentity: { providerId: "allanime", value: "0" },
    });
  });

  test("invalidateEpisodePlaybackCaches clears resolve cache and source inventory", async () => {
    const deletedCacheKeys: string[] = [];
    const deletedInventory: string[] = [];

    await invalidateEpisodePlaybackCaches({
      cacheStore: cacheStoreWithDelete(async (key) => {
        deletedCacheKeys.push(key);
      }),
      sourceInventory: {
        delete: async (input) => {
          deletedInventory.push(`${input.providerId}:${input.titleId}:${input.episode}`);
        },
      },
      providerId: "vidking",
      title: { id: "1396", type: "series", name: "Breaking Bad" },
      episode: { season: 1, episode: 5 },
      mode: "series",
      config,
    });

    expect(deletedCacheKeys.length).toBe(1);
    expect(deletedInventory).toEqual(["vidking:1396:5"]);
  });

  test("invalidateEpisodePlaybackCaches deletes the exact provider-native inventory row", async () => {
    const deletedInventoryIdentities: Array<ProviderEpisodeIdentity | undefined> = [];

    await invalidateEpisodePlaybackCaches({
      cacheStore: cacheStoreWithDelete(async () => {}),
      sourceInventory: {
        delete: async (input) => {
          deletedInventoryIdentities.push(input.providerEpisodeIdentity);
        },
      },
      providerId: "allanime",
      title: { id: "anilist:1", type: "series", name: "Native Anime" },
      episode: {
        season: 1,
        episode: 1,
        providerEpisodeIdentity: { providerId: "allanime", value: "0" },
      },
      mode: "anime",
      config,
    });

    expect(deletedInventoryIdentities).toEqual([{ providerId: "allanime", value: "0" }]);
  });

  test("invalidateEpisodePlaybackCaches clears base and selected source cache keys", async () => {
    const deletedCacheKeys: string[] = [];

    await invalidateEpisodePlaybackCaches({
      cacheStore: cacheStoreWithDelete(async (key) => {
        deletedCacheKeys.push(key);
      }),
      sourceInventory: { delete: async () => {} },
      providerId: "vidking",
      title: { id: "1396", type: "series", name: "Breaking Bad" },
      episode: { season: 1, episode: 5 },
      mode: "series",
      config,
      selectedSourceId: "source:zoro",
      selectedStreamId: "stream:zoro:1080",
    });

    expect(deletedCacheKeys).toHaveLength(2);
    expect(deletedCacheKeys[0]).toContain(":balanced:none:none");
    expect(deletedCacheKeys[1]).toContain(":balanced:source:zoro:stream:zoro:1080");
  });
});

test("inventory and recovery keys consume session track overrides without changing defaults", async () => {
  const title = { id: "1396", type: "series" as const, name: "Series" };
  const episode = { season: 1, episode: 1 };
  const overrides = { subtitle: "fr", quality: "best" };
  const expected = buildSourceInventoryCacheInput(
    "vidlink",
    title,
    episode,
    "series",
    config,
    overrides,
  );
  expect(expected).toMatchObject({ subtitleLanguage: "fr", qualityPreference: "best" });
  const deleted: unknown[] = [];
  await invalidateEpisodePlaybackCaches({
    providerId: "vidlink",
    title,
    episode,
    mode: "series",
    config,
    overrides,
    cacheStore: cacheStoreWithDelete(async () => {}),
    sourceInventory: {
      delete: async (input) => {
        deleted.push(input);
      },
    },
  });
  expect(deleted).toEqual([expected]);
  expect(config.seriesLanguageProfile.subtitle).toBe("none");
});
