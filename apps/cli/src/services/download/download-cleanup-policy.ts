import { shouldAutoCleanupOfflineJob } from "@/services/offline/offline-sync-policy";
import type { HistoryEntry } from "@/services/persistence/HistoryStore";
import type { DownloadJobRecord } from "@kunai/storage";

export type ProtectedDownloadEpisode = {
  readonly titleId: string;
  readonly season?: number;
  readonly episode?: number;
};

export type DownloadCleanupCandidate = {
  readonly job: DownloadJobRecord;
  readonly reason: "watched";
  readonly watchedAt: string;
};

export function selectDownloadCleanupCandidates(input: {
  readonly jobs: readonly DownloadJobRecord[];
  readonly historyByTitle: ReadonlyMap<string, readonly HistoryEntry[]>;
  readonly nowMs: number;
  readonly graceDays: number;
  readonly pinnedJobIds?: ReadonlySet<string>;
  readonly protectedEpisodes?: readonly ProtectedDownloadEpisode[];
}): readonly DownloadCleanupCandidate[] {
  const candidates: DownloadCleanupCandidate[] = [];
  for (const job of input.jobs) {
    if (input.pinnedJobIds?.has(job.id)) continue;
    if (isProtectedEpisode(job, input.protectedEpisodes ?? [])) continue;

    const decision = shouldAutoCleanupOfflineJob({
      job,
      historyEntries: input.historyByTitle.get(job.titleId) ?? [],
      nowMs: input.nowMs,
      graceDays: input.graceDays,
    });
    if (!decision.shouldDelete) continue;

    candidates.push({
      job,
      reason: decision.reason,
      watchedAt: decision.watchedAt,
    });
  }
  return candidates;
}

function isProtectedEpisode(
  job: DownloadJobRecord,
  protectedEpisodes: readonly ProtectedDownloadEpisode[],
): boolean {
  return protectedEpisodes.some((episode) => {
    if (episode.titleId !== job.titleId) return false;
    if (episode.season !== undefined && episode.season !== job.season) return false;
    if (episode.episode !== undefined && episode.episode !== job.episode) return false;
    return true;
  });
}
