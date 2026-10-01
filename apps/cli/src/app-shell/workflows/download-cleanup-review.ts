import { openSessionPicker } from "@/app-shell/session-picker";
import type { Container } from "@/container";
import type { OverlayPickerOption } from "@/domain/session/SessionState";
import { formatBytes } from "@/services/diagnostics/runtime-memory";
import {
  collectDownloadCleanupCandidates,
  deleteDownloadCleanupCandidates,
  describeCleanupCandidate,
  formatCleanupSize,
  summarizeDownloadCleanupCandidates,
} from "@/services/download/download-cleanup-candidates";
import type { DownloadCleanupCandidate } from "@/services/download/download-cleanup-policy";

const PICK_ALL = "cleanup:all";
const PICK_JOB = "cleanup:job:";
const PICK_BACK = "cleanup:back";
const CONFIRM_DELETE = "cleanup:delete";
const CONFIRM_KEEP = "cleanup:keep";

function cleanupFeedback(container: Container, note: string): void {
  container.stateManager.dispatch({ type: "SET_PLAYBACK_FEEDBACK", note });
}

function buildReviewOptions(
  candidates: readonly DownloadCleanupCandidate[],
): readonly OverlayPickerOption[] {
  const summary = summarizeDownloadCleanupCandidates(candidates);
  const size = formatCleanupSize(summary);
  return [
    {
      value: PICK_ALL,
      label: `Clean up all ${summary.count} downloads`,
      detail: size
        ? `Delete every listed file after confirmation · frees about ${size}`
        : "Delete every listed file after confirmation",
      tone: "error",
    },
    ...candidates.map((candidate): OverlayPickerOption => {
      const option = describeCleanupCandidate(candidate);
      return {
        value: `${PICK_JOB}${option.jobId}`,
        label: option.label,
        detail: option.detail,
      };
    }),
  ];
}

async function confirmCleanup(
  container: Container,
  title: string,
  subtitle: string,
  confirmLabel: string,
): Promise<boolean> {
  const picked = await openSessionPicker(container.stateManager, {
    type: "list_picker",
    title,
    subtitle,
    options: [
      { value: CONFIRM_KEEP, label: "Keep files", detail: "Go back without deleting anything" },
      {
        value: CONFIRM_DELETE,
        label: confirmLabel,
        detail: "Remove local files and queue records",
        tone: "error",
      },
    ],
  });
  return picked === CONFIRM_DELETE;
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
 *
 * Rendered as a `list_picker` overlay rather than root content so it layers
 * correctly when launched from inside the library/downloads overlay — a
 * root-content mount would stay hidden behind the open modal.
 */
export async function openDownloadCleanupReview(container: Container): Promise<void> {
  let candidates = collectDownloadCleanupCandidates(container);
  if (candidates.length === 0) {
    await openSessionPicker(container.stateManager, {
      type: "list_picker",
      title: "Clean up watched downloads",
      subtitle: container.config.autoCleanupWatched
        ? "No watched downloads are ready for cleanup right now."
        : "Watched-download cleanup suggestions are off — enable autoCleanupWatched in settings to get them.",
      options: [{ value: PICK_BACK, label: "Back", detail: "Close without changing anything" }],
    });
    return;
  }

  while (candidates.length > 0) {
    const summary = summarizeDownloadCleanupCandidates(candidates);
    const size = formatCleanupSize(summary);
    const picked = await openSessionPicker(container.stateManager, {
      type: "list_picker",
      title: "Clean up watched downloads",
      subtitle:
        `${summary.count} eligible${size ? ` · about ${size} recoverable` : ""} — ` +
        "nothing is deleted without confirmation",
      options: buildReviewOptions(candidates),
    });
    if (!picked || picked === PICK_BACK) return;

    if (picked === PICK_ALL) {
      const confirmed = await confirmCleanup(
        container,
        `Delete all ${summary.count} watched downloads?`,
        "Removes video, subtitle, and thumbnail files plus queue records — cannot be undone.",
        "Delete all listed downloads",
      );
      if (!confirmed) continue;
      const report = await deleteDownloadCleanupCandidates(container.downloadService, candidates);
      reportDeleteOutcome(container, report.deleted, report.failed);
      return;
    }

    const jobId = picked.startsWith(PICK_JOB) ? picked.slice(PICK_JOB.length) : null;
    const candidate = jobId ? candidates.find((item) => item.job.id === jobId) : undefined;
    if (!candidate) {
      // The job was deleted between listing and picking; re-list rather than
      // acting on a stale row.
      candidates = collectDownloadCleanupCandidates(container);
      continue;
    }
    const option = describeCleanupCandidate(candidate);
    const confirmed = await confirmCleanup(
      container,
      `Delete ${option.label}?`,
      `${option.detail} — cannot be undone.`,
      "Delete download",
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
