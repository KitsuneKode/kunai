import type { EpisodeInfo, PlaybackTimingMetadata, TitleInfo } from "@/domain/types";
import { fetchPlaybackTimingMetadataDetailed } from "@/introdb";

import type {
  PlaybackTimingFetchContext,
  PlaybackTimingSource,
  PlaybackTimingSourceFetchResult,
  TimingContentMode,
} from "./PlaybackTimingSource";

/** IntroDB `tmdb_id` must be a TMDB id; anime provider opaque ids would 404 or waste calls. */
function isLikelyTmdbNumericId(id: string): boolean {
  return /^\d{1,12}$/.test(id);
}

function resolveIntroDbTmdbId(title: TitleInfo): string {
  return title.externalIds?.tmdbId ?? title.id;
}

export const IntroDbTimingSource: PlaybackTimingSource = {
  name: "introdb",

  canHandle(title: TitleInfo, mode: TimingContentMode): boolean {
    if (mode === "anime") {
      return Boolean(title.externalIds?.tmdbId) || isLikelyTmdbNumericId(title.id);
    }
    return true;
  },

  async fetch(opts: {
    title: TitleInfo;
    episode: EpisodeInfo;
    signal?: AbortSignal;
    context?: PlaybackTimingFetchContext;
  }): Promise<PlaybackTimingMetadata | null> {
    const detailed = await IntroDbTimingSource.fetchDetailed!(opts);
    return detailed.metadata;
  },

  async fetchDetailed(opts: {
    title: TitleInfo;
    episode: EpisodeInfo;
    signal?: AbortSignal;
    context?: PlaybackTimingFetchContext;
  }): Promise<PlaybackTimingSourceFetchResult> {
    const { title, episode, signal, context } = opts;
    const tmdbId = resolveIntroDbTmdbId(title);
    return fetchPlaybackTimingMetadataDetailed({
      tmdbId,
      type: title.type,
      season: title.type === "series" ? episode.season : undefined,
      episode: title.type === "series" ? episode.episode : undefined,
      signal,
      parentSignal: context?.parentSignal,
    });
  },
};
