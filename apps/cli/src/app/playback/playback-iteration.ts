// Per-outer-loop-iteration read context for the post-play menu loop.
// Sibling to PlaybackRunState: run state survives across iterations; iteration
// snapshots the episode/title/result facts that the menu reads each pass.
import type { PlaybackEpisodePickerOptions } from "@/app/playback/playback-episode-picker";
import type { EpisodeAvailability } from "@/domain/playback/playback-policy";
import type {
  EpisodeInfo,
  EpisodePickerOption,
  PlaybackResult,
  PlaybackTimingMetadata,
  SearchResult,
  TitleInfo,
} from "@/domain/types";
import type { StreamInfo } from "@/domain/types";
import type { HistoryProgress } from "@kunai/storage";

export interface PlaybackIteration {
  readonly title: TitleInfo;
  readonly currentEpisode: EpisodeInfo;
  readonly episodeAvailability: EpisodeAvailability;
  readonly result: PlaybackResult;
  readonly effectiveTimingCurrent: PlaybackTimingMetadata | null;
  /** Catalog autoplay advance target; may differ from availability.nextEpisode. */
  readonly nextEpisode: EpisodeInfo | null | undefined;
  readonly catalogAutoplayEndBanner: string | undefined;
  readonly shellEpisodePicker: PlaybackEpisodePickerOptions;
  readonly watchedEntries: readonly HistoryProgress[];
  readonly prefetchedRecommendationItems: readonly SearchResult[] | null;
  readonly currentAnimeEpisodes: readonly EpisodePickerOption[] | undefined;
  readonly preparedStream: StreamInfo;
  /** Provider id at menu entry; may change during in-menu provider switch. */
  resolvedProviderId: string;
  /** Last provider id observed inside the post-play loop (B5/B7). */
  postPlayProviderId: string;
  /** One-shot recovery tracks panel on first menu paint when streams exist. */
  openRecoverySourcePanelOnPostPlay: boolean;
  /** B3: user declined near-end auto-next; suppress re-offer until navigation. */
  nearEndAutoNextDeclined: boolean;
  /** B1: stopAfterCurrent snapshot before pre-menu clearing mutates session. */
  readonly stopAfterCurrentAtMenuEntry: boolean;
  /** TC4: title control auto-presented once this post-play iteration. */
  titleControlAutoPresented: boolean;
}

export function createPlaybackIteration(input: {
  readonly title: TitleInfo;
  readonly currentEpisode: EpisodeInfo;
  readonly episodeAvailability: EpisodeAvailability;
  readonly result: PlaybackResult;
  readonly effectiveTimingCurrent: PlaybackTimingMetadata | null;
  readonly nextEpisode: EpisodeInfo | null | undefined;
  readonly catalogAutoplayEndBanner: string | undefined;
  readonly shellEpisodePicker: PlaybackEpisodePickerOptions;
  readonly watchedEntries: readonly HistoryProgress[];
  readonly prefetchedRecommendationItems: readonly SearchResult[] | null;
  readonly currentAnimeEpisodes: readonly EpisodePickerOption[] | undefined;
  readonly preparedStream: StreamInfo;
  readonly resolvedProviderId: string;
  readonly openRecoverySourcePanelOnPostPlay: boolean;
  readonly stopAfterCurrentAtMenuEntry: boolean;
}): PlaybackIteration {
  return {
    ...input,
    postPlayProviderId: input.resolvedProviderId,
    nearEndAutoNextDeclined: false,
    titleControlAutoPresented: false,
  };
}
