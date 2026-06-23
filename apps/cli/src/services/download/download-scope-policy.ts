import { planEpisodeQueue, type EpisodeQueueScope } from "@/domain/queue/QueuePlanner";
import type { EpisodeInfo } from "@/domain/types";

export type DownloadScope = EpisodeQueueScope;

export function normalizeAutoDownloadNextCount(count: number | undefined): number {
  if (!Number.isFinite(count)) return 1;
  return Math.max(1, Math.min(24, Math.trunc(count ?? 1)));
}

export function selectEpisodesForDownloadScope(input: {
  readonly scope: DownloadScope;
  readonly currentEpisode: EpisodeInfo;
  readonly nextEpisode?: EpisodeInfo | null;
  readonly seasonEpisodes?: readonly EpisodeInfo[] | null;
}): readonly EpisodeInfo[] {
  return planEpisodeQueue(input).episodes;
}
