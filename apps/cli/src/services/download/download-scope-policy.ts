import { planEpisodeQueue, type EpisodeQueueScope } from "@/domain/queue/QueuePlanner";
import type { EpisodeInfo } from "@/domain/types";
import type { AutoDownloadMode } from "@/services/persistence/ConfigService";

export type DownloadScope = EpisodeQueueScope;

export function normalizeAutoDownloadNextCount(count: number | undefined): number {
  if (!Number.isFinite(count)) return 1;
  return Math.max(1, Math.min(24, Math.trunc(count ?? 1)));
}

export function resolveAutoDownloadScope(input: {
  readonly mode: AutoDownloadMode;
  readonly nextCount?: number;
}): DownloadScope | null {
  if (input.mode === "off") return null;
  if (input.mode === "season") return { type: "current-season-remaining" };
  const count = normalizeAutoDownloadNextCount(input.nextCount);
  return count > 1 ? { type: "next-n", count } : { type: "next-episode" };
}

export function selectEpisodesForDownloadScope(input: {
  readonly scope: DownloadScope;
  readonly currentEpisode: EpisodeInfo;
  readonly nextEpisode?: EpisodeInfo | null;
  readonly seasonEpisodes?: readonly EpisodeInfo[] | null;
}): readonly EpisodeInfo[] {
  return planEpisodeQueue(input).episodes;
}
