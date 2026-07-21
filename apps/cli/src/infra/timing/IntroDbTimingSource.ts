import { resolveProvenNumericTmdbId } from "@/domain/catalog/tmdb-identity";
import type { EpisodeInfo, PlaybackTimingMetadata, TitleInfo } from "@/domain/types";
import { fetchPlaybackTimingMetadataDetailed } from "@/introdb";

import type {
  PlaybackTimingFetchContext,
  PlaybackTimingSource,
  PlaybackTimingSourceFetchResult,
  TimingContentMode,
} from "./PlaybackTimingSource";

export const IntroDbTimingSource: PlaybackTimingSource = {
  name: "introdb",

  canHandle(title: TitleInfo, mode: TimingContentMode): boolean {
    return resolveProvenNumericTmdbId(title, mode) !== null;
  },

  async fetch(opts: {
    title: TitleInfo;
    episode: EpisodeInfo;
    signal?: AbortSignal;
    context?: PlaybackTimingFetchContext;
  }): Promise<PlaybackTimingMetadata | null> {
    const fetchDetailed = IntroDbTimingSource.fetchDetailed;
    if (!fetchDetailed) return null;
    const detailed = await fetchDetailed(opts);
    return detailed.metadata;
  },

  async fetchDetailed(opts: {
    title: TitleInfo;
    episode: EpisodeInfo;
    signal?: AbortSignal;
    context?: PlaybackTimingFetchContext;
  }): Promise<PlaybackTimingSourceFetchResult> {
    const { title, episode, signal, context } = opts;
    // Default series: bare numeric title.id remains valid for non-anime callers
    // that invoke fetchDetailed without an aggregator mode.
    const mode: TimingContentMode = context?.mode ?? "series";
    const tmdbId = resolveProvenNumericTmdbId(title, mode);
    if (!tmdbId) {
      return { metadata: null, failureClass: "identity-missing" };
    }

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
