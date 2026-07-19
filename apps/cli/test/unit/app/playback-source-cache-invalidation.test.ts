import { describe, expect, test } from "bun:test";

import {
  buildSourceInventoryCacheInput,
  invalidateEpisodePlaybackCaches,
} from "@/app/playback/playback-source-cache-invalidation";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

const config = {
  animeLanguageProfile: { audio: "original", subtitle: "en", quality: "auto" },
  seriesLanguageProfile: { audio: "original", subtitle: "none", quality: "720p" },
  movieLanguageProfile: { audio: "original", subtitle: "en", quality: "auto" },
  startupPriority: "balanced",
} as KitsuneConfig;

describe("playback-source-cache-invalidation", () => {
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

  test("invalidateEpisodePlaybackCaches clears resolve cache and source inventory", async () => {
    const deletedCacheKeys: string[] = [];
    const deletedInventory: string[] = [];

    await invalidateEpisodePlaybackCaches({
      cacheStore: {
        delete: async (key: string) => {
          deletedCacheKeys.push(key);
        },
      } as never,
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

  test("invalidateEpisodePlaybackCaches clears base and selected source cache keys", async () => {
    const deletedCacheKeys: string[] = [];

    await invalidateEpisodePlaybackCaches({
      cacheStore: {
        delete: async (key: string) => {
          deletedCacheKeys.push(key);
        },
      } as never,
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
