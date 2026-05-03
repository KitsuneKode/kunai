import type { EpisodeInfo, PlaybackTimingMetadata, TitleInfo } from "@/domain/types";
import { mergeTimingMetadata } from "@/aniskip";

import type { PlaybackTimingSource, TimingContentMode } from "./PlaybackTimingSource";

export class PlaybackTimingAggregator {
  constructor(private readonly sources: readonly PlaybackTimingSource[]) {}

  async resolve(
    title: TitleInfo,
    episode: EpisodeInfo,
    mode: TimingContentMode,
    signal?: AbortSignal,
  ): Promise<PlaybackTimingMetadata | null> {
    const applicable = this.sources.filter((s) => s.canHandle(title, mode));
    if (applicable.length === 0) return null;

    const results = await Promise.all(applicable.map((s) => s.fetch({ title, episode, signal })));

    return results.reduce(
      (acc, result) => mergeTimingMetadata(acc, result),
      null as PlaybackTimingMetadata | null,
    );
  }
}
