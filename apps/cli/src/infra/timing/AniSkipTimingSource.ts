import { fetchAniSkipTimingMetadataDetailed } from "@/aniskip";
import type { EpisodeInfo, PlaybackTimingMetadata, TitleInfo } from "@/domain/types";

import type {
  PlaybackTimingFetchContext,
  PlaybackTimingSource,
  PlaybackTimingSourceFetchResult,
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
    const detailed = await AniSkipTimingSource.fetchDetailed!(opts);
    return detailed.metadata;
  },

  async fetchDetailed(opts: {
    title: TitleInfo;
    episode: EpisodeInfo;
    signal?: AbortSignal;
    context?: PlaybackTimingFetchContext;
  }): Promise<PlaybackTimingSourceFetchResult> {
    const { title, episode, signal, context } = opts;
    if (title.type !== "series") {
      return { metadata: null, failureClass: "not-applicable" };
    }
    return fetchAniSkipTimingMetadataDetailed({
      anilistId: title.id,
      externalIds: title.externalIds,
      titleName: title.name,
      titleYear: title.year,
      episode: episode.episode ?? 1,
      signal,
      parentSignal: context?.parentSignal,
      providerId: context?.providerId,
    });
  },
};
