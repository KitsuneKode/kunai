import type { EpisodeInfo, PlaybackTimingMetadata, TitleInfo } from "@/domain/types";

import { mergeTimingMetadata } from "./merge-timing";
import type {
  PlaybackTimingFetchContext,
  PlaybackTimingSource,
  TimingContentMode,
} from "./PlaybackTimingSource";

export class PlaybackTimingAggregator {
  constructor(private readonly sources: readonly PlaybackTimingSource[]) {}

  async resolve(
    title: TitleInfo,
    episode: EpisodeInfo,
    mode: TimingContentMode,
    signal?: AbortSignal,
    context?: PlaybackTimingFetchContext,
  ): Promise<PlaybackTimingMetadata | null> {
    const applicable = this.sources.filter((s) => s.canHandle(title, mode));
    if (applicable.length === 0) return null;

    const results = await Promise.all(
      applicable.map((s) => s.fetch({ title, episode, signal, context })),
    );

    return results.reduce(
      (acc, result) => mergeTimingMetadata(acc, result),
      null as PlaybackTimingMetadata | null,
    );
  }
}
