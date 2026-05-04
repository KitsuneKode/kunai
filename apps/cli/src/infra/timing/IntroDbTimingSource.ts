import type { EpisodeInfo, PlaybackTimingMetadata, TitleInfo } from "@/domain/types";
import { fetchPlaybackTimingMetadata } from "@/introdb";

import type {
  PlaybackTimingFetchContext,
  PlaybackTimingSource,
  TimingContentMode,
} from "./PlaybackTimingSource";

/** IntroDB `tmdb_id` must be a TMDB id; anime provider opaque ids would 404 or waste calls. */
function isLikelyTmdbNumericId(id: string): boolean {
  return /^\d{1,12}$/.test(id);
}

export const IntroDbTimingSource: PlaybackTimingSource = {
  name: "introdb",

  canHandle(title: TitleInfo, mode: TimingContentMode): boolean {
    if (mode === "anime") {
      return isLikelyTmdbNumericId(title.id);
    }
    return true;
  },

  async fetch(opts: {
    title: TitleInfo;
    episode: EpisodeInfo;
    signal?: AbortSignal;
    context?: PlaybackTimingFetchContext;
  }): Promise<PlaybackTimingMetadata | null> {
    const { title, episode, signal } = opts;
    return fetchPlaybackTimingMetadata({
      tmdbId: title.id,
      type: title.type,
      season: title.type === "series" ? episode.season : undefined,
      episode: title.type === "series" ? episode.episode : undefined,
      signal,
    });
  },
};
