import type { EpisodeInfo, PlaybackTimingMetadata, TitleInfo } from "@/domain/types";

export type TimingContentMode = "series" | "anime" | "movie";

export interface PlaybackTimingSource {
  readonly name: string;
  canHandle(title: TitleInfo, mode: TimingContentMode): boolean;
  fetch(opts: {
    title: TitleInfo;
    episode: EpisodeInfo;
    signal?: AbortSignal;
  }): Promise<PlaybackTimingMetadata | null>;
}
