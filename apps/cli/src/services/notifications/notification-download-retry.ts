import type { MediaItemIdentity } from "@/domain/media/media-item-identity";
import type { DownloadService } from "@/services/download/DownloadService";
import type { DownloadJobRecord } from "@kunai/storage";

import type {
  NotificationDownloadRetryOutcome,
  NotificationDownloadRetryTarget,
} from "./NotificationActionRouter";

type RetryPort = Pick<DownloadService, "getJob" | "listFailed" | "retry" | "kickQueue">;

const RETRYABLE: ReadonlySet<DownloadJobRecord["status"]> = new Set([
  "failed",
  "aborted",
  "repairable",
]);

/**
 * Retry for a download-failed notice. A notice names its failed job, so Retry
 * requeues that job exactly as Downloads does: same source, profile and output.
 * It used to translate into a fresh generic download of the notice's numbers,
 * which for an anime notice (absolute episode only) defaulted to S01E01 and
 * left the failed job behind (Sol review #3).
 */
/** What the inbox calls to retry a failed download notice. */
export type NotificationDownloadRetry = {
  readonly retryFailed: (
    target: NotificationDownloadRetryTarget,
  ) => Promise<NotificationDownloadRetryOutcome>;
};

export function createNotificationDownloadRetry(downloads: RetryPort): NotificationDownloadRetry {
  return {
    async retryFailed({ jobId, item }) {
      const job = jobId ? downloads.getJob(jobId) : onlyFailedJobFor(downloads, item);
      if (!job) {
        return {
          status: "unavailable",
          reason: jobId
            ? "That download is no longer in Downloads."
            : "Open Downloads to retry this one.",
        };
      }
      if (!RETRYABLE.has(job.status)) {
        return { status: "unavailable", reason: `That download is ${job.status}, not failed.` };
      }
      try {
        await downloads.retry(job.id);
      } catch (error) {
        return {
          status: "unavailable",
          reason: error instanceof Error ? error.message : String(error),
        };
      }
      // A repairable job is fixed in place; anything else waits in the queue —
      // kicked under the Downloads source, since this is the same retry.
      if (job.status !== "repairable") downloads.kickQueue("download-manager");
      return { status: "requeued" };
    },
  };
}

/**
 * A notice from before job ids were recorded: retry only when exactly one
 * failed job matches its episode. Two candidates are a guess, and a guess here
 * downloads the wrong file.
 */
function onlyFailedJobFor(
  downloads: RetryPort,
  item: MediaItemIdentity,
): DownloadJobRecord | undefined {
  const matches = downloads.listFailed(500).filter((job) => {
    if (job.titleId !== item.titleId) return false;
    if (job.mediaKind === "anime") return job.episode === item.absoluteEpisode;
    return job.season === item.season && job.episode === item.episode;
  });
  return matches.length === 1 ? matches[0] : undefined;
}
