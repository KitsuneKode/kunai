import { chooseFromListShell } from "@/app-shell/pickers/choose-from-list-shell";
import type { ListShellActionContext, ShellOption } from "@/app-shell/pickers/list-shell-types";
import type { Container } from "@/container";
import { formatBytes } from "@/services/diagnostics/runtime-memory";
import {
  collectDownloadCleanupCandidates,
  deleteDownloadCleanupCandidates,
  describeCleanupCandidate,
  formatCleanupSize,
  summarizeDownloadCleanupCandidates,
} from "@/services/download/download-cleanup-candidates";
import type { DownloadCleanupCandidate } from "@/services/download/download-cleanup-policy";

type CleanupPick = { readonly type: "all" } | { readonly type: "job"; readonly jobId: string };

function cleanupFeedback(container: Container, note: string): void {
  container.stateManager.dispatch({ type: "SET_PLAYBACK_FEEDBACK", note });
}

function buildReviewOptions(
  candidates: readonly DownloadCleanupCandidate[],
): readonly ShellOption<CleanupPick>[] {
  const summary = summarizeDownloadCleanupCandidates(candidates);
  const size = formatCleanupSize(summary);
  return [
    {
      value: { type: "all" },
      label: `Clean up all ${summary.count} downloads`,
      detail: size
        ? `Delete every listed file after confirmation · frees about ${size}`
        : "Delete every listed file after confirmation",
      destructive: true,
    },
    ...candidates.map((candidate): ShellOption<CleanupPick> => {
      const option = describeCleanupCandidate(candidate);
      return {
        value: { type: "job", jobId: option.jobId },
        label: option.label,
        detail: option.detail,
      };
    }),
  ];
}

async function confirmCleanup(
  title: string,
  subtitle: string,
  confirmLabel: string,
  actionContext?: ListShellActionContext,
): Promise<boolean> {
  const confirmed = await chooseFromListShell<boolean>({
    title,
    subtitle,
    actionContext,
    options: [
      { value: false, label: "Keep files", detail: "Go back without deleting anything" },
      {
        value: true,
        label: confirmLabel,
        detail: "Remove local files and queue records",
        destructive: true,
      },
    ],
  });
  return confirmed === true;
}

function reportDeleteOutcome(
  container: Container,
  deleted: readonly DownloadCleanupCandidate[],
  failed: readonly { candidate: DownloadCleanupCandidate; message: string }[],
): void {
  const deletedBytes = deleted.reduce((sum, c) => sum + (c.job.fileSize ?? 0), 0);
  const freed = deletedBytes > 0 ? ` · freed ${formatBytes(deletedBytes)}` : "";
  if (failed.length === 0) {
    cleanupFeedback(
      container,
      `Cleanup: deleted ${deleted.length} watched ${deleted.length === 1 ? "download" : "downloads"}${freed}`,
    );
    return;
  }
  const failureNames = failed
    .slice(0, 3)
    .map((failure) => describeCleanupCandidate(failure.candidate).label)
    .join(", ");
  const more = failed.length > 3 ? ` +${failed.length - 3} more` : "";
  cleanupFeedback(
    container,
    `Cleanup: deleted ${deleted.length}, failed ${failed.length} (${failureNames}${more})${freed}`,
  );
}

/**
 * Interactive review of watched-download cleanup candidates.
 *
 * Reached from `/cleanup-downloads`, the `c` key on the downloads surface,
 * and the cleanup banner on the library and downloads surfaces. Lists every
 * eligible download with the retention rule that released it, then requires
 * an explicit per-item or all-items confirmation before anything is deleted. Deletion goes through
 * `DownloadService.deleteJob` so artifact ownership, subtitles, and temp files
 * are handled by the same path as a manual queue delete. Picker rows re-list
 * after each deletion, so a candidate that disappeared underneath is simply
 * absent rather than a stale row.
 */
export async function openDownloadCleanupReview(
  container: Container,
  actionContext?: ListShellActionContext,
): Promise<void> {
  let candidates = collectDownloadCleanupCandidates(container);
  if (candidates.length === 0) {
    cleanupFeedback(
      container,
      container.config.autoCleanupWatched
        ? "No watched downloads are ready for cleanup right now."
        : "Watched-download cleanup is off — enable autoCleanupWatched to get suggestions.",
    );
    return;
  }

  while (candidates.length > 0) {
    const summary = summarizeDownloadCleanupCandidates(candidates);
    const size = formatCleanupSize(summary);
    const picked = await chooseFromListShell<CleanupPick>({
      title: "Clean up watched downloads",
      subtitle:
        `${summary.count} eligible${size ? ` · about ${size} recoverable` : ""} — ` +
        "nothing is deleted without confirmation",
      options: buildReviewOptions(candidates),
      actionContext,
    });
    if (!picked) return;

    if (picked.type === "all") {
      const confirmed = await confirmCleanup(
        `Delete all ${summary.count} watched downloads?`,
        "Removes video, subtitle, and thumbnail files plus queue records — cannot be undone.",
        "Delete all listed downloads",
        actionContext,
      );
      if (!confirmed) continue;
      const report = await deleteDownloadCleanupCandidates(container.downloadService, candidates);
      reportDeleteOutcome(container, report.deleted, report.failed);
      return;
    }

    const candidate = candidates.find((item) => item.job.id === picked.jobId);
    if (!candidate) {
      // The job was deleted between listing and picking; re-list rather than
      // acting on a stale row.
      candidates = collectDownloadCleanupCandidates(container);
      continue;
    }
    const option = describeCleanupCandidate(candidate);
    const confirmed = await confirmCleanup(
      `Delete ${option.label}?`,
      `${option.detail} — cannot be undone.`,
      "Delete download",
      actionContext,
    );
    if (!confirmed) continue;
    const report = await deleteDownloadCleanupCandidates(container.downloadService, [candidate]);
    reportDeleteOutcome(container, report.deleted, report.failed);
    candidates = collectDownloadCleanupCandidates(container);
    if (candidates.length === 0) {
      cleanupFeedback(container, "Cleanup review finished — nothing left to clean up.");
      return;
    }
  }
}
