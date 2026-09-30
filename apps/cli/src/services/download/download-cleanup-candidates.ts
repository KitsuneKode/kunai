import { formatBytes } from "@/services/diagnostics/runtime-memory";
import {
  parseOfflineTitleCleanupPreference,
  selectDownloadCleanupCandidates,
  type DownloadCleanupCandidate,
} from "@/services/download/download-cleanup-policy";
import type { DownloadJobRecord, HistoryProgress, OfflineTitlePolicyRecord } from "@kunai/storage";

/**
 * The storage/config surface cleanup collection needs. `Container` satisfies
 * this structurally; tests pass narrow fakes so no database or config file is
 * required to exercise the path.
 */
export interface DownloadCleanupSources {
  readonly config: {
    readonly autoCleanupWatched: boolean;
    readonly autoCleanupGraceDays: number;
    readonly protectedDownloadJobIds: readonly string[];
  };
  readonly downloadService: {
    listCompleted(limit?: number): readonly DownloadJobRecord[];
  };
  readonly historyRepository: {
    listRecent(limit?: number): readonly HistoryProgress[];
  };
  readonly offlineTitlePolicies: {
    listByTitleIds(titleIds: readonly string[]): readonly OfflineTitlePolicyRecord[];
  };
}

export interface DownloadCleanupSummary {
  readonly count: number;
  /** Sum of `fileSize` over candidates that recorded one; see `sizedCount`. */
  readonly totalBytes: number;
  /** How many candidates contributed a known `fileSize` to `totalBytes`. */
  readonly sizedCount: number;
}

export interface DownloadCleanupReviewOption {
  readonly jobId: string;
  readonly label: string;
  readonly detail: string;
}

export interface DownloadCleanupDeleteFailure {
  readonly candidate: DownloadCleanupCandidate;
  readonly message: string;
}

export interface DownloadCleanupDeleteReport {
  readonly deleted: readonly DownloadCleanupCandidate[];
  readonly failed: readonly DownloadCleanupDeleteFailure[];
}

/**
 * Reusable candidate collection — the same read path startup diagnostics and
 * the interactive review use, so the banner, the picker, and the low-space
 * hint can never disagree about what is eligible.
 *
 * Returns an empty array (rather than throwing) when history cannot be read:
 * a corrupt history table must not hide downloads or break the review UI.
 * Honors `autoCleanupWatched`: with the feature off there are no candidates,
 * and nothing on disk is ever deleted implicitly regardless.
 */
export function collectDownloadCleanupCandidates(
  sources: DownloadCleanupSources,
  input: { readonly nowMs?: number } = {},
): readonly DownloadCleanupCandidate[] {
  const { config } = sources;
  if (!config.autoCleanupWatched) return [];

  const graceDays = Math.max(0, config.autoCleanupGraceDays);
  const nowMs = input.nowMs ?? Date.now();
  const jobs = sources.downloadService.listCompleted(500);
  const titleIds = new Set(jobs.map((job) => job.titleId));
  const historyByTitle = new Map<string, HistoryProgress[]>();
  const recentHistory = (() => {
    try {
      return sources.historyRepository.listRecent(1_000);
    } catch {
      return [];
    }
  })();
  for (const entry of recentHistory) {
    if (!titleIds.has(entry.titleId)) continue;
    const entries = historyByTitle.get(entry.titleId) ?? [];
    entries.push(entry);
    historyByTitle.set(entry.titleId, entries);
  }
  const titlePolicies = new Map(
    sources.offlineTitlePolicies
      .listByTitleIds([...titleIds])
      .map((policy) => [policy.titleId, parseOfflineTitleCleanupPreference(policy.cleanupJson)])
      .filter(
        (
          entry,
        ): entry is [string, NonNullable<ReturnType<typeof parseOfflineTitleCleanupPreference>>] =>
          Boolean(entry[1]),
      ),
  );
  return selectDownloadCleanupCandidates({
    jobs,
    historyByTitle,
    nowMs,
    graceDays,
    pinnedJobIds: new Set(config.protectedDownloadJobIds),
    titlePolicies,
  });
}

export function summarizeDownloadCleanupCandidates(
  candidates: readonly DownloadCleanupCandidate[],
): DownloadCleanupSummary {
  let totalBytes = 0;
  let sizedCount = 0;
  for (const candidate of candidates) {
    const size = candidate.job.fileSize;
    if (typeof size === "number" && Number.isFinite(size) && size > 0) {
      totalBytes += size;
      sizedCount += 1;
    }
  }
  return { count: candidates.length, totalBytes, sizedCount };
}

/** "4.2 GiB" when sizes are known, "" when nothing recorded a fileSize. */
export function formatCleanupSize(summary: DownloadCleanupSummary): string {
  return summary.sizedCount > 0 ? formatBytes(summary.totalBytes) : "";
}

/**
 * One-line banner for the library/download surfaces, e.g.
 * "3 watched downloads can be cleaned up · 4.2 GiB recoverable".
 */
export function formatCleanupBannerText(summary: DownloadCleanupSummary): string {
  if (summary.count === 0) return "";
  const size = formatCleanupSize(summary);
  const noun = summary.count === 1 ? "download" : "downloads";
  return size
    ? `${summary.count} watched ${noun} can be cleaned up · ${size} recoverable`
    : `${summary.count} watched ${noun} can be cleaned up`;
}

/**
 * Suffix appended to an insufficient-disk refusal so the error names the
 * recovery path instead of just the failure, e.g.
 * " · 3 watched downloads hold 4.2 GiB — /cleanup-downloads reviews them".
 * Returns "" when there is nothing to recover (or cleanup is disabled), so
 * callers can concatenate unconditionally.
 */
export function formatCleanupRecoveryHint(sources: DownloadCleanupSources): string {
  const candidates = collectDownloadCleanupCandidates(sources);
  const summary = summarizeDownloadCleanupCandidates(candidates);
  if (summary.count === 0) return "";
  const size = formatCleanupSize(summary);
  const noun = summary.count === 1 ? "download holds" : "downloads hold";
  return size
    ? ` · ${summary.count} watched ${noun} ${size} — /cleanup-downloads reviews them`
    : ` · ${summary.count} watched ${noun} space — /cleanup-downloads reviews them`;
}

function watchedAgoLabel(watchedAt: string, nowMs: number): string {
  const watchedMs = Date.parse(watchedAt);
  if (!Number.isFinite(watchedMs)) return "watched earlier";
  const days = Math.max(0, Math.floor((nowMs - watchedMs) / (24 * 60 * 60 * 1000)));
  if (days === 0) return "watched today";
  if (days === 1) return "watched 1d ago";
  return `watched ${days}d ago`;
}

function eligibilityLabel(candidate: DownloadCleanupCandidate): string {
  const eligibility = candidate.eligibility;
  return eligibility.kind === "keep-last-watched"
    ? `outside keep-last-${eligibility.count}`
    : `past ${eligibility.graceDays}d grace`;
}

function candidateLabel(candidate: DownloadCleanupCandidate): string {
  const { job } = candidate;
  const episode =
    job.contentType === "movie"
      ? ""
      : job.season !== undefined
        ? ` S${job.season}E${job.episode ?? "?"}`
        : job.episode !== undefined
          ? ` E${job.episode}`
          : "";
  return `${job.titleName}${episode}`;
}

/** Row text for the interactive review picker. */
export function describeCleanupCandidate(
  candidate: DownloadCleanupCandidate,
  nowMs = Date.now(),
): DownloadCleanupReviewOption {
  const { job } = candidate;
  const parts = [
    watchedAgoLabel(candidate.watchedAt, nowMs),
    eligibilityLabel(candidate),
    typeof job.fileSize === "number" && job.fileSize > 0 ? formatBytes(job.fileSize) : null,
    job.outputPath,
  ].filter((part): part is string => Boolean(part));
  return { jobId: job.id, label: candidateLabel(candidate), detail: parts.join(" · ") };
}

/**
 * Delete the given candidates one at a time through `deleteJob` — the
 * ownership-safe path that also removes subtitles, thumbnails, and temp files.
 * A failure on one item is reported and the loop continues; the caller renders
 * the per-item outcome, nothing is swallowed.
 */
export async function deleteDownloadCleanupCandidates(
  downloadService: {
    deleteJob(jobId: string, options?: { deleteArtifact?: boolean }): Promise<void>;
  },
  candidates: readonly DownloadCleanupCandidate[],
): Promise<DownloadCleanupDeleteReport> {
  const deleted: DownloadCleanupCandidate[] = [];
  const failed: DownloadCleanupDeleteFailure[] = [];
  for (const candidate of candidates) {
    try {
      await downloadService.deleteJob(candidate.job.id, { deleteArtifact: true });
      deleted.push(candidate);
    } catch (error) {
      failed.push({
        candidate,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { deleted, failed };
}
