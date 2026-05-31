import { historyContentType } from "@/services/continuation/history-progress";
import type { DownloadJobRecord, HistoryProgress } from "@kunai/storage";

export type OfflineCleanupDecision =
  | {
      readonly shouldDelete: false;
      readonly reason: "not-completed" | "not-watched" | "grace-period";
    }
  | { readonly shouldDelete: true; readonly reason: "watched"; readonly watchedAt: string };

export function shouldAutoCleanupOfflineJob(input: {
  readonly job: DownloadJobRecord;
  readonly historyEntries: readonly HistoryProgress[];
  readonly nowMs: number;
  readonly graceDays: number;
}): OfflineCleanupDecision {
  if (input.job.status !== "completed") {
    return { shouldDelete: false, reason: "not-completed" };
  }

  const graceMs = Math.max(0, input.graceDays) * 24 * 60 * 60 * 1000;
  const cutoff = input.nowMs - graceMs;
  const watched = input.historyEntries.find((entry) => {
    if (!entry.completed) return false;
    const historyKind = input.job.mediaKind === "movie" ? "movie" : "series";
    if (historyContentType(entry) !== historyKind) return false;
    if (historyKind !== "movie") {
      if ((entry.season ?? 1) !== (input.job.season ?? 1)) return false;
      if ((entry.episode ?? entry.absoluteEpisode ?? 1) !== (input.job.episode ?? 1)) return false;
    }
    return Number.isFinite(Date.parse(entry.updatedAt));
  });

  if (!watched) return { shouldDelete: false, reason: "not-watched" };
  if (Date.parse(watched.updatedAt) > cutoff) {
    return { shouldDelete: false, reason: "grace-period" };
  }
  return { shouldDelete: true, reason: "watched", watchedAt: watched.updatedAt };
}
