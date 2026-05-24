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

export type OfflineTitleCleanupPreference =
  | { readonly mode: "keep-last-watched"; readonly count: number }
  | { readonly mode: "cleanup-watched"; readonly graceDays: number };

export function parseOfflineTitleCleanupPreference(
  cleanupJson: string | undefined,
): OfflineTitleCleanupPreference | undefined {
  if (!cleanupJson) return undefined;
  try {
    const parsed = JSON.parse(cleanupJson) as Record<string, unknown>;
    if (parsed.mode === "keep-last-watched") {
      const count = typeof parsed.count === "number" ? parsed.count : 1;
      return {
        mode: "keep-last-watched",
        count: Number.isFinite(count) ? Math.max(0, Math.min(20, Math.trunc(count))) : 1,
      };
    }
    if (parsed.mode === "cleanup-watched") {
      const graceDays = typeof parsed.graceDays === "number" ? parsed.graceDays : 7;
      return {
        mode: "cleanup-watched",
        graceDays: Number.isFinite(graceDays)
          ? Math.max(0, Math.min(365, Math.trunc(graceDays)))
          : 7,
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function selectDownloadCleanupCandidates(input: {
  readonly jobs: readonly DownloadJobRecord[];
  readonly historyByTitle: ReadonlyMap<string, readonly HistoryEntry[]>;
  readonly nowMs: number;
  readonly graceDays: number;
  readonly pinnedJobIds?: ReadonlySet<string>;
  readonly protectedEpisodes?: readonly ProtectedDownloadEpisode[];
  readonly titlePolicies?: ReadonlyMap<string, OfflineTitleCleanupPreference>;
}): readonly DownloadCleanupCandidate[] {
  const retainedJobIds = selectRetainedWatchedJobs(input);
  const candidates: DownloadCleanupCandidate[] = [];
  for (const job of input.jobs) {
    if (input.pinnedJobIds?.has(job.id)) continue;
    if (isProtectedEpisode(job, input.protectedEpisodes ?? [])) continue;
    if (retainedJobIds.has(job.id)) continue;
    const titlePolicy = input.titlePolicies?.get(job.titleId);

    const decision = shouldAutoCleanupOfflineJob({
      job,
      historyEntries: input.historyByTitle.get(job.titleId) ?? [],
      nowMs: input.nowMs,
      graceDays: titlePolicy?.mode === "cleanup-watched" ? titlePolicy.graceDays : input.graceDays,
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

function selectRetainedWatchedJobs(input: {
  readonly jobs: readonly DownloadJobRecord[];
  readonly historyByTitle: ReadonlyMap<string, readonly HistoryEntry[]>;
  readonly titlePolicies?: ReadonlyMap<string, OfflineTitleCleanupPreference>;
}): ReadonlySet<string> {
  const retained = new Set<string>();
  for (const [titleId, policy] of input.titlePolicies ?? []) {
    if (policy.mode !== "keep-last-watched" || policy.count < 1) continue;
    const historyEntries = input.historyByTitle.get(titleId) ?? [];
    input.jobs
      .filter((job) => job.titleId === titleId)
      .map((job) => ({
        job,
        history: historyEntries
          .filter(
            (entry) =>
              entry.completed && entry.season === job.season && entry.episode === job.episode,
          )
          .sort((left, right) => Date.parse(right.watchedAt) - Date.parse(left.watchedAt))[0],
      }))
      .filter((item): item is { job: DownloadJobRecord; history: HistoryEntry } =>
        Boolean(item.history),
      )
      .sort(
        (left, right) =>
          Date.parse(right.history.watchedAt) - Date.parse(left.history.watchedAt) ||
          (right.job.season ?? 0) - (left.job.season ?? 0) ||
          (right.job.episode ?? 0) - (left.job.episode ?? 0),
      )
      .slice(0, policy.count)
      .forEach((item) => retained.add(item.job.id));
  }
  return retained;
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
