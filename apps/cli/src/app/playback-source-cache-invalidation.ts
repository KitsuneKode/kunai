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
  const isAnime = mode === "anime";
  return {
    providerId,
    mediaKind: isAnime ? "anime" : title.type,
    titleId: title.id,
    season: episode.season,
    episode: episode.episode,
    audioMode: isAnime
      ? config.animeLanguageProfile.audio
      : title.type === "movie"
        ? config.movieLanguageProfile.audio
        : config.seriesLanguageProfile.audio,
    subtitleLanguage: isAnime
      ? config.animeLanguageProfile.subtitle
      : title.type === "movie"
        ? config.movieLanguageProfile.subtitle
        : config.seriesLanguageProfile.subtitle,
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
}): Promise<void> {
  const mode = input.mode;
  const cacheKey = buildApiStreamResolveCacheKey({
    providerId: input.providerId,
    title: input.title,
    episode: input.episode,
    mode,
    audioPreference:
      mode === "anime"
        ? input.config.animeLanguageProfile.audio
        : input.title.type === "movie"
          ? input.config.movieLanguageProfile.audio
          : input.config.seriesLanguageProfile.audio,
    subtitlePreference:
      mode === "anime"
        ? input.config.animeLanguageProfile.subtitle
        : input.title.type === "movie"
          ? input.config.movieLanguageProfile.subtitle
          : input.config.seriesLanguageProfile.subtitle,
    qualityPreference:
      mode === "anime"
        ? input.config.animeLanguageProfile.quality
        : input.title.type === "movie"
          ? input.config.movieLanguageProfile.quality
          : input.config.seriesLanguageProfile.quality,
    startupPriority: input.config.startupPriority,
  });

  try {
    await input.cacheStore.delete(cacheKey);
  } catch {
    // best-effort
  }

  try {
    await input.sourceInventory.delete(
      buildSourceInventoryCacheInput(
        input.providerId,
        input.title,
        input.episode,
        mode,
        input.config,
      ),
    );
  } catch {
    // best-effort
  }
}
