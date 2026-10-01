import { planEpisodeQueue, type EpisodeQueueScope } from "@/domain/queue/QueuePlanner";
import type { EpisodeInfo } from "@/domain/types";

export type DownloadScope = EpisodeQueueScope;

export function selectEpisodesForDownloadScope(input: {
  readonly scope: DownloadScope;
  readonly currentEpisode: EpisodeInfo;
  readonly nextEpisode?: EpisodeInfo | null;
  readonly seasonEpisodes?: readonly EpisodeInfo[] | null;
}): readonly EpisodeInfo[] {
  return planEpisodeQueue(input).episodes;
}
