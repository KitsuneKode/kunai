import { fetchAniSkipTimingMetadata } from "@/aniskip";
import type { EpisodeInfo, PlaybackTimingMetadata, TitleInfo } from "@/domain/types";

import type {
  PlaybackTimingFetchContext,
  PlaybackTimingSource,
  TimingContentMode,
} from "./PlaybackTimingSource";

export const AniSkipTimingSource: PlaybackTimingSource = {
  name: "aniskip",

  canHandle(_title: TitleInfo, mode: TimingContentMode): boolean {
    return mode === "anime";
  },

  async fetch(opts: {
    title: TitleInfo;
    episode: EpisodeInfo;
    signal?: AbortSignal;
    context?: PlaybackTimingFetchContext;
  }): Promise<PlaybackTimingMetadata | null> {
    const { title, episode, signal, context } = opts;
    if (title.type !== "series") return null;
    return fetchAniSkipTimingMetadata({
      anilistId: title.id,
      titleName: title.name,
      titleYear: title.year,
      episode: episode.episode ?? 1,
      signal,
      providerId: context?.providerId,
    });
  },
};
