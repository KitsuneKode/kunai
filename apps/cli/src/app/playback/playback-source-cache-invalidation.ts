import {
  playbackAudioPreference,
  playbackQualityPreference,
  playbackSubtitlePreference,
} from "@/app/playback/playback-profile-context";
import type { EpisodeInfo, ShellMode, TitleInfo } from "@/domain/types";
import { buildApiStreamResolveCacheKey } from "@/services/cache/stream-resolve-cache";
import type { CacheStore } from "@/services/persistence/CacheStore";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import type {
  SourceInventoryCacheInput,
  SourceInventoryService,
} from "@/services/playback/SourceInventoryService";
import type { CoreProviderManifest } from "@kunai/core";

export function buildSourceInventoryCacheInput(
  providerId: string,
  title: TitleInfo,
  episode: EpisodeInfo,
  mode: ShellMode,
  config: KitsuneConfig,
): SourceInventoryCacheInput {
  const profileContext = { mode, title, config };
  return {
    providerId,
    mediaKind: mode === "youtube" ? "video" : mode === "anime" ? "anime" : title.type,
    titleId: title.id,
    season: episode.season,
    episode: episode.episode,
    providerEpisodeIdentity: episode.providerEpisodeIdentity,
    audioMode: playbackAudioPreference(profileContext),
    subtitleLanguage: playbackSubtitlePreference(profileContext),
    qualityPreference: playbackQualityPreference(profileContext),
    startupPriority: config.startupPriority,
  };
}

/** Drop persisted resolve + inventory entries so recover must hit the provider again. */
export async function invalidateEpisodePlaybackCaches(input: {
  readonly cacheStore: CacheStore;
  readonly sourceInventory: Pick<SourceInventoryService, "delete">;
  readonly providerId: string;
  /**
   * The provider's manifest decides the resolve-cache key shape — six anime
   * providers key without `season`, so falling back to the default token list
   * computes a key that was never written and the stale row survives.
   */
  readonly providerManifest?: CoreProviderManifest;
  readonly title: TitleInfo;
  readonly episode: EpisodeInfo;
  readonly mode: ShellMode;
  readonly config: KitsuneConfig;
  readonly selectedSourceId?: string | null;
  readonly selectedStreamId?: string | null;
}): Promise<void> {
  const profileContext = {
    mode: input.mode,
    title: input.title,
    config: input.config,
  };
  const cacheKeyBase = {
    providerId: input.providerId,
    providerManifest: input.providerManifest,
    title: input.title,
    episode: input.episode,
    mode: input.mode,
    audioPreference: playbackAudioPreference(profileContext),
    subtitlePreference: playbackSubtitlePreference(profileContext),
    qualityPreference: playbackQualityPreference(profileContext),
    startupPriority: input.config.startupPriority,
  } as const;
  const cacheKeys = new Set([
    buildApiStreamResolveCacheKey(cacheKeyBase),

    ...(input.selectedSourceId || input.selectedStreamId
      ? [
          buildApiStreamResolveCacheKey({
            ...cacheKeyBase,
            selectedSourceId: input.selectedSourceId ?? undefined,
            selectedStreamId: input.selectedStreamId ?? undefined,
          }),
        ]
      : []),
  ]);

  for (const cacheKey of cacheKeys) {
    try {
      await input.cacheStore.delete(cacheKey);
    } catch {
      // best-effort
    }
  }

  try {
    await input.sourceInventory.delete(
      buildSourceInventoryCacheInput(
        input.providerId,
        input.title,
        input.episode,
        input.mode,
        input.config,
      ),
    );
  } catch {
    // best-effort
  }
}
