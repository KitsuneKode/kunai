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
    mediaKind: mode === "anime" ? "anime" : title.type,
    titleId: title.id,
    season: episode.season,
    episode: episode.episode,
    audioMode: playbackAudioPreference(profileContext),
    subtitleLanguage: playbackSubtitlePreference(profileContext),
    startupPriority: config.startupPriority,
  };
}

/** Drop persisted resolve + inventory entries so recover must hit the provider again. */
export async function invalidateEpisodePlaybackCaches(input: {
  readonly cacheStore: CacheStore;
  readonly sourceInventory: Pick<SourceInventoryService, "delete">;
  readonly providerId: string;
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
