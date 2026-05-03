import type { EpisodeInfo, PlaybackTimingMetadata, TitleInfo } from "@/domain/types";
import { fetchPlaybackTimingMetadata } from "@/introdb";

import type { PlaybackTimingSource, TimingContentMode } from "./PlaybackTimingSource";

export const IntroDbTimingSource: PlaybackTimingSource = {
  name: "introdb",

  canHandle(_title: TitleInfo, _mode: TimingContentMode): boolean {
    return true; // IntroDB covers series, movies, and anime alike
  },

  async fetch(opts: {
    title: TitleInfo;
    episode: EpisodeInfo;
    signal?: AbortSignal;
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
