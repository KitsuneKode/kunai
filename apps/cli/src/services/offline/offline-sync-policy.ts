import { sameEpisodeNumbering } from "@/domain/media/episode-numbering";
import { historyContentType } from "@/services/continuation/history-progress";
import type { DownloadJobRecord, HistoryProgress } from "@kunai/storage";

export type OfflineCleanupDecision =
  | {
      readonly shouldDelete: false;
      readonly reason: "not-completed" | "not-watched" | "grace-period";
    }
  | { readonly shouldDelete: true; readonly reason: "watched"; readonly watchedAt: string };

/**
 * Does this history row describe the episode a download job holds?
 *
 * Both sides are normalized, and that symmetry is the point. Absolute-numbered
 * anime carries no season and puts its number in the history row's
 * `absoluteEpisode` while the job keeps it in `episode`, so a match that
 * normalized only one side (`(entry.season ?? 1) === job.season`) compared
 * `1 === undefined` and never matched anything.
 *
 * The keep-set and the delete-set both read this: a rule that answered
 * differently on the two sides deleted episodes the retention policy had been
 * asked to keep.
 */
export function historyMatchesDownloadJob(
  entry: Pick<
    HistoryProgress,
    "season" | "episode" | "absoluteEpisode" | "mediaKind" | "completed"
  >,
  job: Pick<DownloadJobRecord, "season" | "episode" | "mediaKind">,
): boolean {
  const historyKind = job.mediaKind === "movie" ? "movie" : "series";
  if (historyContentType(entry) !== historyKind) return false;
  if (historyKind === "movie") return true;
  return sameEpisodeNumbering(entry, job);
}

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
  const watched = input.historyEntries.find(
    (entry) =>
      entry.completed &&
      historyMatchesDownloadJob(entry, input.job) &&
      Number.isFinite(Date.parse(entry.updatedAt)),
  );

  if (!watched) return { shouldDelete: false, reason: "not-watched" };
  if (Date.parse(watched.updatedAt) > cutoff) {
    return { shouldDelete: false, reason: "grace-period" };
  }
  return { shouldDelete: true, reason: "watched", watchedAt: watched.updatedAt };
}
