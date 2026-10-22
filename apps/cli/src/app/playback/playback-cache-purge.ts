import { PlaybackSelectionCoordinator } from "@/app/playback/playback-selection-coordinator";
import { invalidateEpisodePlaybackCaches } from "@/app/playback/playback-source-cache-invalidation";
import { invalidateTitlePlaybackCaches } from "@/app/playback/playback-title-cache-invalidation";
import type { Container } from "@/container";
import type { EpisodeInfo, TitleInfo, ShellMode } from "@/domain/types";
import { encodeProviderEpisodeIdentity } from "@kunai/types";

/** Only the persistence and session readers used by the purge actions. */
type PlaybackCachePurgeContext = Pick<
  Container,
  "episodePlaybackSelection" | "titlePlaybackSource"
> & {
  readonly stateManager: { getState(): { provider: string; mode: ShellMode } };
  readonly cacheStore: Pick<Container["cacheStore"], "delete">;
  readonly sourceInventory: Pick<Container["sourceInventory"], "delete">;
  readonly config: Pick<Container["config"], "getRaw">;
  readonly providerRegistry: Pick<Container["providerRegistry"], "getManifest">;
  readonly historyRepository: Pick<Container["historyRepository"], "listByTitle">;
  readonly diagnosticsService: Pick<Container["diagnosticsService"], "record">;
};

async function loadPurgeSelections(
  container: PlaybackCachePurgeContext,
  title: TitleInfo,
  providerId: string,
  episodes: readonly EpisodeInfo[],
): Promise<PlaybackSelectionCoordinator> {
  const selections = new PlaybackSelectionCoordinator({
    titleId: title.id,
    episodePlaybackSelection: container.episodePlaybackSelection,
    titlePlaybackSource: container.titlePlaybackSource,
  });
  await selections.hydrateTitleSource(providerId);
  // Selection stores lazily load their files. Finish each load before reading
  // another episode so the purge cannot observe a partially hydrated store.
  for (const episode of episodes) await selections.hydrateEpisode(providerId, episode);
  return selections;
}

function uniqueEpisodes(episodes: readonly EpisodeInfo[]): EpisodeInfo[] {
  const seen = new Set<string>();
  const unique: EpisodeInfo[] = [];
  for (const episode of episodes) {
    const nativeIdentity = episode.providerEpisodeIdentity
      ? encodeProviderEpisodeIdentity(episode.providerEpisodeIdentity)
      : "none";
    const key = `${episode.season}:${episode.episode}:${nativeIdentity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(episode);
  }
  return unique;
}

export async function purgeEpisodePlaybackCache(
  container: PlaybackCachePurgeContext,
  title: TitleInfo,
  episode: EpisodeInfo,
): Promise<void> {
  const state = container.stateManager.getState();
  const selections = await loadPurgeSelections(container, title, state.provider, [episode]);
  const selection = selections.getEffective(state.provider, episode);
  await invalidateEpisodePlaybackCaches({
    cacheStore: container.cacheStore,
    sourceInventory: container.sourceInventory,
    providerId: state.provider,
    providerManifest: container.providerRegistry.getManifest(state.provider),
    title,
    episode,
    mode: state.mode,
    config: container.config.getRaw(),
    selectedSourceId: selection.sourceId,
    selectedStreamId: selection.streamId,
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
  container: PlaybackCachePurgeContext,
  title: TitleInfo,
  episodes?: readonly EpisodeInfo[],
): Promise<void> {
  const state = container.stateManager.getState();
  const fromHistory = container.historyRepository.listByTitle(title.id).map((entry) => ({
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

  const selections = await loadPurgeSelections(container, title, state.provider, resolvedEpisodes);
  await invalidateTitlePlaybackCaches({
    cacheStore: container.cacheStore,
    sourceInventory: container.sourceInventory,
    providerId: state.provider,
    providerManifest: container.providerRegistry.getManifest(state.provider),
    title,
    mode: state.mode,
    config: container.config.getRaw(),
    episodes: resolvedEpisodes,
    selectionForEpisode: (episode) => selections.getEffective(state.provider, episode),
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
