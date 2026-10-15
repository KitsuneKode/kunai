import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  purgeEpisodePlaybackCache,
  purgeTitlePlaybackCaches,
} from "@/app/playback/playback-cache-purge";
import { loadProductionProviderModules } from "@/container/bootstrap-providers";
import type { EpisodeInfo, ShellMode } from "@/domain/types";
import { buildApiStreamResolveCacheKey } from "@/services/cache/stream-resolve-cache";
import { DEFAULT_CONFIG, type KitsuneConfig } from "@/services/persistence/ConfigService";
import { EpisodePlaybackSelectionService } from "@/services/playback/EpisodePlaybackSelectionService";
import { TitlePlaybackSourceService } from "@/services/playback/TitlePlaybackSourceService";

const config: KitsuneConfig = {
  ...DEFAULT_CONFIG,
  animeLanguageProfile: { audio: "original", subtitle: "en", quality: "auto" },
  seriesLanguageProfile: { audio: "original", subtitle: "en", quality: "auto" },
  movieLanguageProfile: { audio: "original", subtitle: "en", quality: "auto" },
  youtubeLanguageProfile: { audio: "original", subtitle: "en", quality: "auto" },
  startupPriority: "balanced",
};

let dir = "";
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = "";
});

describe("production playback cache purge", () => {
  for (const scope of ["episode", "title"] as const) {
    test(`${scope} purge removes current pinned keys and preserves preferences for every provider`, async () => {
      dir = await mkdtemp(join(tmpdir(), "kunai-purge-"));
      const modules = await loadProductionProviderModules({
        providerPriority: [],
        animeProviderPriority: [],
      });
      for (const module of modules) {
        const mode: ShellMode =
          module.providerId === "youtube"
            ? "youtube"
            : module.manifest.mediaKinds.includes("anime")
              ? "anime"
              : "series";
        const title = {
          id: mode === "anime" ? "anilist:1" : "tmdb:99",
          name: "Purge",
          type: "series",
        } as const;
        const episodes: EpisodeInfo[] = [
          {
            season: 1,
            episode: 1,
            ...(mode === "anime"
              ? { providerEpisodeIdentity: { providerId: module.providerId, value: "0" } }
              : {}),
          },
          {
            season: 1,
            episode: mode === "anime" ? 1 : 2,
            ...(mode === "anime"
              ? { providerEpisodeIdentity: { providerId: module.providerId, value: "1" } }
              : {}),
          },
        ];
        const episodePlaybackSelection = new EpisodePlaybackSelectionService(
          join(dir, `${module.providerId}-episodes.json`),
        );
        const titlePlaybackSource = new TitlePlaybackSourceService(
          join(dir, `${module.providerId}-titles.json`),
        );
        await titlePlaybackSource.set({
          providerId: module.providerId,
          titleId: title.id,
          sourceId: "source:default",
        });
        await episodePlaybackSelection.set({
          providerId: module.providerId,
          titleId: title.id,
          ...episodes[0]!,
          sourceId: "source:override",
          streamId: "stream:override:720",
        });
        const stored = new Set<string>(["unrelated-title"]);
        for (const [index, episode] of episodes.entries()) {
          const key = {
            providerId: module.providerId,
            providerManifest: module.manifest,
            title,
            episode,
            mode,
            audioPreference: "original",
            subtitlePreference: "en",
            qualityPreference: "auto",
            startupPriority: config.startupPriority,
          };
          stored.add(buildApiStreamResolveCacheKey(key));
          stored.add(
            buildApiStreamResolveCacheKey({
              ...key,
              selectedSourceId: index === 0 ? "source:override" : "source:default",
              selectedStreamId: index === 0 ? "stream:override:720" : undefined,
            }),
          );
        }
        const container = {
          stateManager: { getState: () => ({ provider: module.providerId, mode }) },
          config: { getRaw: () => config },
          providerRegistry: { getManifest: () => module.manifest },
          episodePlaybackSelection,
          titlePlaybackSource,
          cacheStore: {
            delete: async (key: string) => {
              stored.delete(key);
            },
          },
          sourceInventory: { delete: async () => {} },
          historyRepository: { listByTitle: () => [] },
          diagnosticsService: { record: () => {} },
        };
        if (scope === "episode") {
          for (const episode of episodes)
            await purgeEpisodePlaybackCache(container, title, episode);
        } else {
          await purgeTitlePlaybackCaches(container, title, episodes);
        }
        expect([...stored], module.providerId).toEqual(["unrelated-title"]);
        expect(
          (await titlePlaybackSource.get({ providerId: module.providerId, titleId: title.id }))
            ?.sourceId,
        ).toBe("source:default");
        expect(
          (
            await episodePlaybackSelection.get({
              providerId: module.providerId,
              titleId: title.id,
              ...episodes[0]!,
            })
          )?.streamId,
        ).toBe("stream:override:720");
      }
    });
  }
});
