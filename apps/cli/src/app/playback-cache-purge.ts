import { invalidateEpisodePlaybackCaches } from "@/app/playback-source-cache-invalidation";
import { invalidateTitlePlaybackCaches } from "@/app/playback-title-cache-invalidation";
import type { Container } from "@/container";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";

function uniqueEpisodes(episodes: readonly EpisodeInfo[]): EpisodeInfo[] {
  const seen = new Set<string>();
  const unique: EpisodeInfo[] = [];
  for (const episode of episodes) {
    const key = `${episode.season}:${episode.episode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(episode);
  }
  return unique;
}

export async function purgeEpisodePlaybackCache(
  container: Container,
  title: TitleInfo,
  episode: EpisodeInfo,
): Promise<void> {
  const state = container.stateManager.getState();
  await invalidateEpisodePlaybackCaches({
    cacheStore: container.cacheStore,
    sourceInventory: container.sourceInventory,
    providerId: state.provider,
    title,
    episode,
    mode: state.mode,
    config: container.config.getRaw(),
  });
  container.diagnosticsService.record({
    category: "cache",
    message: "Episode playback cache purged",
    titleId: title.id,
    season: episode.season,
    episode: episode.episode,
    context: { providerId: state.provider },
  });
}

export async function purgeTitlePlaybackCaches(
  container: Container,
  title: TitleInfo,
  episodes?: readonly EpisodeInfo[],
): Promise<void> {
  const state = container.stateManager.getState();
  const fromHistory = (await container.historyStore.listByTitle(title.id)).map((entry) => ({
    season: entry.season ?? 1,
    episode: entry.episode ?? 1,
  }));
  const resolvedEpisodes = uniqueEpisodes([...(episodes ?? []), ...fromHistory]);
  if (resolvedEpisodes.length === 0) {
    container.diagnosticsService.record({
      category: "cache",
      message: "Title playback cache purge skipped — no episodes to target",
      titleId: title.id,
    });
    return;
  }

  await invalidateTitlePlaybackCaches({
    cacheStore: container.cacheStore,
    sourceInventory: container.sourceInventory,
    providerId: state.provider,
    title,
    mode: state.mode,
    config: container.config.getRaw(),
    episodes: resolvedEpisodes,
    cancelReason: "title-cache-purge",
  });
  container.diagnosticsService.record({
    category: "cache",
    message: "Title playback cache purged",
    titleId: title.id,
    context: {
      providerId: state.provider,
      episodeCount: resolvedEpisodes.length,
    },
  });
}
