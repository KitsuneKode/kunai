import type { EpisodeInfo, PlaybackTimingMetadata, TitleInfo } from "@/domain/types";
import { fetchAniSkipTimingMetadata } from "@/aniskip";

import type { PlaybackTimingSource, TimingContentMode } from "./PlaybackTimingSource";

export const AniSkipTimingSource: PlaybackTimingSource = {
  name: "aniskip",

  canHandle(_title: TitleInfo, mode: TimingContentMode): boolean {
    return mode === "anime";
  },

  async fetch(opts: {
    title: TitleInfo;
    episode: EpisodeInfo;
    signal?: AbortSignal;
  }): Promise<PlaybackTimingMetadata | null> {
    const { title, episode, signal } = opts;
    if (title.type !== "series") return null;
    return fetchAniSkipTimingMetadata({
      anilistId: title.id,
      episode: episode.episode ?? 1,
      signal,
    });
  },
};
