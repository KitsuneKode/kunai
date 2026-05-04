import type { EpisodeInfo, PlaybackTimingMetadata, TitleInfo } from "@/domain/types";

export type TimingContentMode = "series" | "anime" | "movie";

/** Optional hints for timing sources (e.g. MAL resolution for AniSkip per catalog provider). */
export interface PlaybackTimingFetchContext {
  /** Active provider when timing is resolved (e.g. `allanime` for AllAnime GraphQL `malId`). */
  readonly providerId?: string;
}

export interface PlaybackTimingSource {
  readonly name: string;
  canHandle(title: TitleInfo, mode: TimingContentMode): boolean;
  fetch(opts: {
    title: TitleInfo;
    episode: EpisodeInfo;
    signal?: AbortSignal;
    context?: PlaybackTimingFetchContext;
  }): Promise<PlaybackTimingMetadata | null>;
}
