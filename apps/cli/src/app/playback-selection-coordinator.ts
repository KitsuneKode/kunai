import { emptyStreamSelectionIntent, type StreamSelectionIntent } from "@/app/source-quality";
import { resolveEffectiveStreamSelection } from "@/domain/playback/playback-selection-policy";
import type { EpisodeInfo } from "@/domain/types";
import type { EpisodePlaybackSelectionService } from "@/services/playback/EpisodePlaybackSelectionService";
import type { TitlePlaybackSourceService } from "@/services/playback/TitlePlaybackSourceService";

export class PlaybackSelectionCoordinator {
  private readonly episodeByKey = new Map<string, StreamSelectionIntent>();
  private readonly titleSourceByProvider = new Map<string, string>();

  constructor(
    private readonly deps: {
      readonly titleId: string;
      readonly episodePlaybackSelection: EpisodePlaybackSelectionService;
      readonly titlePlaybackSource: TitlePlaybackSourceService;
    },
  ) {}

  episodeKey(providerId: string, episode: EpisodeInfo): string {
    return `${providerId}:${this.deps.titleId}:${episode.season}:${episode.episode}`;
  }

  titleSourceKey(providerId: string): string {
    return `${providerId}:${this.deps.titleId}`;
  }

  async hydrateEpisode(providerId: string, episode: EpisodeInfo): Promise<void> {
    const key = this.episodeKey(providerId, episode);
    if (this.episodeByKey.has(key)) return;

    const persisted = await this.deps.episodePlaybackSelection
      .get({
        providerId,
        titleId: this.deps.titleId,
        season: episode.season,
        episode: episode.episode,
      })
      .catch(() => null);

    if (persisted) {
      this.episodeByKey.set(key, {
        sourceId: persisted.sourceId ?? null,
        streamId: persisted.streamId ?? null,
      });
    }
  }

  async hydrateTitleSource(providerId: string): Promise<void> {
    const key = this.titleSourceKey(providerId);
    if (this.titleSourceByProvider.has(key)) return;

    const persisted = await this.deps.titlePlaybackSource
      .get({ providerId, titleId: this.deps.titleId })
      .catch(() => null);

    if (persisted?.sourceId) {
      this.titleSourceByProvider.set(key, persisted.sourceId);
    } else {
      this.titleSourceByProvider.set(key, "");
    }
  }

  async hydrate(providerId: string, episode: EpisodeInfo): Promise<void> {
    await Promise.all([
      this.hydrateTitleSource(providerId),
      this.hydrateEpisode(providerId, episode),
    ]);
  }

  getEffective(providerId: string, episode: EpisodeInfo): StreamSelectionIntent {
    const episodeSelection = this.episodeByKey.get(this.episodeKey(providerId, episode));
    const titleSourceId = this.titleSourceByProvider.get(this.titleSourceKey(providerId));
    const resolved = resolveEffectiveStreamSelection({
      episode: episodeSelection
        ? { sourceId: episodeSelection.sourceId, streamId: episodeSelection.streamId }
        : null,
      titleSourceId: titleSourceId && titleSourceId.length > 0 ? titleSourceId : null,
    });
    return {
      sourceId: resolved.sourceId,
      streamId: resolved.streamId,
    };
  }

  async applyEpisodeSelection(
    providerId: string,
    episode: EpisodeInfo,
    selection: StreamSelectionIntent,
  ): Promise<void> {
    this.episodeByKey.set(this.episodeKey(providerId, episode), selection);
    await this.deps.episodePlaybackSelection
      .set({
        providerId,
        titleId: this.deps.titleId,
        season: episode.season,
        episode: episode.episode,
        sourceId: selection.sourceId,
        streamId: selection.streamId,
      })
      .catch(() => undefined);
  }

  async applyManualSourcePick(
    providerId: string,
    episode: EpisodeInfo,
    sourceId: string,
  ): Promise<void> {
    const selection: StreamSelectionIntent = { sourceId, streamId: null };
    this.titleSourceByProvider.set(this.titleSourceKey(providerId), sourceId);
    await Promise.all([
      this.applyEpisodeSelection(providerId, episode, selection),
      this.deps.titlePlaybackSource
        .set({ providerId, titleId: this.deps.titleId, sourceId })
        .catch(() => undefined),
    ]);
  }

  clearEpisode(providerId: string, episode: EpisodeInfo): void {
    this.episodeByKey.delete(this.episodeKey(providerId, episode));
  }

  /** In-memory episode map only — used when resetting session caches. */
  resetEpisodeMemory(providerId: string, episode: EpisodeInfo): void {
    this.clearEpisode(providerId, episode);
  }

  static emptySelection(): StreamSelectionIntent {
    return emptyStreamSelectionIntent();
  }
}
