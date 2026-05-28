import { describe, expect, test } from "bun:test";

import {
  buildSourceInventoryCacheInput,
  invalidateEpisodePlaybackCaches,
} from "@/app/playback-source-cache-invalidation";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

const config = {
  animeLanguageProfile: { audio: "original", subtitle: "en", quality: "auto" },
  seriesLanguageProfile: { audio: "original", subtitle: "none", quality: "auto" },
  movieLanguageProfile: { audio: "original", subtitle: "en", quality: "auto" },
  startupPriority: "balanced",
} as KitsuneConfig;

describe("playback-source-cache-invalidation", () => {
  test("buildSourceInventoryCacheInput maps series mode from title type", () => {
    expect(
      buildSourceInventoryCacheInput(
        "vidking",
        { id: "1396", type: "series", name: "Breaking Bad" },
        { season: 1, episode: 5 },
        "series",
        config,
      ),
    ).toMatchObject({
      providerId: "vidking",
      mediaKind: "series",
      titleId: "1396",
      season: 1,
      episode: 5,
    });
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
});
