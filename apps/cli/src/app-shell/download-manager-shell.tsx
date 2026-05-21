import { EmptyState, ResizeBlocker } from "@/app-shell/shell-primitives";
import { truncateLine } from "@/app-shell/shell-text";
import { palette } from "@/app-shell/shell-theme";
import { useDebouncedViewportPolicy } from "@/app-shell/use-viewport-policy";
import type { Container } from "@/container";
import type { DownloadJobRecord } from "@kunai/storage";
import { Box, Text, useInput } from "ink";
import React, { useCallback, useEffect, useState } from "react";

function refreshJobLists(container: Container) {
  return {
    activeJobs: container.downloadService.listActive(50).filter((j) => j.status === "running"),
    queuedJobs: container.downloadService.listActive(50).filter((j) => j.status === "queued"),
    completedJobs: container.downloadService.listCompleted(5),
    failedJobs: container.downloadService.listFailed(10),
  };
}

/**
 * Inline download manager content for rendering inside RootOverlayShell.
 * Replaces the old mountRootContent-based DownloadManagerShell.
 *
 * This component does NOT own chrome — it renders job lists and handles
 * download-specific input. The parent overlay shell owns the header, footer,
 * and frame.
 */
export function DownloadManagerContent({
  container,
  onClose,
  onNavigateToLibrary,
}: {
  container: Container;
  onClose: () => void;
  onNavigateToLibrary?: () => void;
}) {
  const viewport = useDebouncedViewportPolicy("picker");
  const [activeJobs, setActiveJobs] = useState<readonly DownloadJobRecord[]>([]);
  const [queuedJobs, setQueuedJobs] = useState<readonly DownloadJobRecord[]>([]);
  const [completedJobs, setCompletedJobs] = useState<readonly DownloadJobRecord[]>([]);
  const [failedJobs, setFailedJobs] = useState<readonly DownloadJobRecord[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [confirmingDeleteIndex, setConfirmingDeleteIndex] = useState<number | null>(null);
  const [repairSweepStatus, setRepairSweepStatus] = useState<string | null>(null);
  const [repairSweepRunning, setRepairSweepRunning] = useState(false);

  const refresh = useCallback(() => {
    const lists = refreshJobLists(container);
    setActiveJobs(lists.activeJobs);
    setQueuedJobs(lists.queuedJobs);
    setCompletedJobs(lists.completedJobs);
    setFailedJobs(lists.failedJobs);
  }, [container]);

  useEffect(() => {
    refresh();
    const unsub = container.downloadService.onEvent((event) => {
      if (
        event.type === "enqueued" ||
        event.type === "progress" ||
        event.type === "complete" ||
        event.type === "failed" ||
        event.type === "aborted" ||
        event.type === "deleted"
      ) {
        refresh();
      }
    });
    return unsub;
  }, [container, refresh]);

  const allJobs = [...activeJobs, ...queuedJobs, ...completedJobs, ...failedJobs];

  useEffect(() => {
    if (selectedIndex >= allJobs.length) {
      setSelectedIndex(Math.max(0, allJobs.length - 1));
    }
  }, [allJobs.length, selectedIndex]);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (input === "l" && onNavigateToLibrary) {
      onNavigateToLibrary();
      return;
    }
    if (input.toLowerCase() === "a") {
      if (repairSweepRunning) return;
      const repairableCount = failedJobs.filter((job) => job.status === "repairable").length;
      if (repairableCount === 0) return;
      setRepairSweepRunning(true);
      setRepairSweepStatus(
        `Repairing ${repairableCount} sidecar${repairableCount === 1 ? "" : "s"}...`,
      );
      void container.downloadService
        .repairRepairableSidecars()
        .then((summary) => {
          setRepairSweepStatus(
            summary.checked === 0
              ? "No repairable sidecars found"
              : `Repair sweep: ${summary.repaired} repaired, ${summary.stillRepairable} still pending, ${summary.failed} failed`,
          );
          refresh();
          return undefined;
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          setRepairSweepStatus(`Repair sweep failed: ${message}`);
        })
        .finally(() => {
          setRepairSweepRunning(false);
        });
      return;
    }
    if (key.upArrow) {
      setConfirmingDeleteIndex(null);
      setSelectedIndex((current) => (current - 1 + allJobs.length) % allJobs.length);
      return;
    }
    if (key.downArrow) {
      setConfirmingDeleteIndex(null);
      setSelectedIndex((current) => (current + 1) % allJobs.length);
      return;
    }
    if (input === "x" || key.delete) {
      const job = allJobs[selectedIndex];
      if (!job) return;
      if (job.status === "running") {
        void container.downloadService.abort(job.id);
        return;
      }
      if (confirmingDeleteIndex === selectedIndex) {
        setConfirmingDeleteIndex(null);
        const deleteArtifact =
          job.status === "failed" ||
          job.status === "repairable" ||
          job.status === "completed" ||
          job.status === "completed-with-notes";
        void container.downloadService.deleteJob(job.id, { deleteArtifact });
        return;
      }
      setConfirmingDeleteIndex(selectedIndex);
      return;
    }
    if (confirmingDeleteIndex !== null) {
      setConfirmingDeleteIndex(null);
    }
    if (input === "r" || key.return) {
      const job = allJobs[selectedIndex];
      if (!job) return;

      if (key.return && (job.status === "completed" || job.status === "completed-with-notes")) {
        void import("./workflows").then(({ playCompletedDownload }) =>
          playCompletedDownload(container, job.id),
        );
        return;
      }

      if (job.status === "failed" || job.status === "repairable" || job.status === "aborted") {
        void container.downloadService
          .retry(job.id)
          .then(() => {
            refresh();
            if (job.status !== "repairable") {
              void container.downloadService.processQueue();
            }
            return undefined;
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            setRepairSweepStatus(`Retry failed: ${message}`);
          });
      }
      return;
    }
  });

  const { tooSmall, minColumns, minRows } = viewport;
  const shellWidth = viewport.columns;

  if (tooSmall) {
    return (
      <ResizeBlocker
        columns={viewport.columns}
        rows={viewport.rows}
        minColumns={minColumns}
        minRows={minRows}
      />
    );
  }

  const isConfirming = (index: number) =>
    confirmingDeleteIndex === index && selectedIndex === index;
  const renderJob = (job: DownloadJobRecord, index: number) => {
    const isSelected = index === selectedIndex;
    const totalBlocks = 10;
    const filled =
      job.status === "running" && typeof job.progressPercent === "number"
        ? Math.max(0, Math.min(totalBlocks, Math.round((job.progressPercent / 100) * totalBlocks)))
        : 0;
    const percent = Math.max(0, Math.min(100, Math.round(job.progressPercent ?? 0)));
    const progressCore =
      job.status === "running" && typeof job.progressPercent === "number"
        ? `[${"█".repeat(filled)}${"░".repeat(totalBlocks - filled)}] ${percent}%`
        : job.status === "queued"
          ? "⏳ queued"
          : job.status === "completed"
            ? "✓ done"
            : job.status === "completed-with-notes"
              ? "✓ notes"
              : job.status === "repairable"
                ? "↻ repair"
                : job.status === "failed"
                  ? "✗ failed"
                  : "— aborted";
    const progressMeta =
      job.status === "running"
        ? [
            formatEta(job),
            job.fileSize ? formatBytes(job.fileSize) : null,
            job.attempt > 1 ? `try ${job.attempt}` : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : job.status === "completed" || job.status === "completed-with-notes"
          ? [
              job.completedAt ? new Date(job.completedAt).toLocaleDateString() : null,
              job.status === "completed-with-notes" ? "sidecar note" : null,
              job.subtitlePath ? "subs" : job.subtitleUrl ? "no subs" : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : job.status === "repairable"
            ? truncateLine(job.errorMessage ?? "Video ready · repair sidecar", 34)
            : job.status === "failed"
              ? truncateLine(job.errorMessage ?? "Failed", 28)
              : job.status;
    const nameStr = `${job.titleName}${job.episode ? ` S${String(job.season ?? 1).padStart(2, "0")}E${String(job.episode).padStart(2, "0")}` : ""}`;
    const statusColor =
      job.status === "running"
        ? palette.amber
        : job.status === "completed"
          ? palette.green
          : job.status === "completed-with-notes" || job.status === "repairable"
            ? palette.amber
            : job.status === "failed"
              ? palette.red
              : job.status === "aborted"
                ? palette.muted
                : palette.amber;
    // Proportional columns: name takes ~45%, progress is fixed 28, meta takes remainder
    const nameWidth = Math.max(20, Math.min(40, Math.floor(shellWidth * 0.45)));
    const progressWidth = 28;
    const metaWidth = Math.max(8, shellWidth - nameWidth - progressWidth - 4);
    return (
      <Box
        key={job.id}
        flexDirection="row"
        backgroundColor={isSelected ? palette.surfaceActive : undefined}
      >
        <Text color={isSelected ? palette.amber : palette.gray}>{isSelected ? "▌ " : "  "}</Text>
        <Box width={nameWidth}>
          <Text color={isSelected ? "white" : undefined} bold={isSelected}>
            {truncateLine(nameStr, nameWidth - 2)}
          </Text>
        </Box>
        <Box width={progressWidth}>
          <Text color={statusColor}>{progressCore}</Text>
        </Box>
        <Box width={metaWidth}>
          <Text color={palette.muted} dimColor>
            {truncateLine(progressMeta, metaWidth)}
          </Text>
        </Box>
        {isConfirming(index) ? (
          <Box marginLeft={1}>
            <Text color={palette.amber} bold>
              {" "}
              x again to confirm delete
            </Text>
          </Box>
        ) : null}
      </Box>
    );
  };

  const renderSection = (
    title: string,
    jobs: readonly DownloadJobRecord[],
    offset: number,
    color: string,
  ) =>
    jobs.length > 0 ? (
      <Box flexDirection="column" marginBottom={1}>
        <Text color={color} bold>
          {title} ({jobs.length})
        </Text>
        {jobs.map((j, i) => renderJob(j, offset + i))}
      </Box>
    ) : null;

  return (
    <Box flexDirection="column" flexGrow={1}>
      {allJobs.length === 0 ? (
        <EmptyState
          icon="⬇"
          title="No active or recent downloads"
          subtitle="Queue episodes from playback with / → Download current episode"
          hint="Completed downloads appear in / → Offline Library"
        />
      ) : (
        <Box flexDirection="column">
          {renderSection("▶ Active", activeJobs, 0, palette.info)}
          {renderSection("⏳ Queued", queuedJobs, activeJobs.length, palette.info)}
          {renderSection(
            "✓ Completed",
            completedJobs,
            activeJobs.length + queuedJobs.length,
            palette.green,
          )}
          {renderSection(
            "⚠ Needs Attention",
            failedJobs,
            activeJobs.length + queuedJobs.length + completedJobs.length,
            palette.red,
          )}
        </Box>
      )}
      {confirmingDeleteIndex !== null ? (
        <Box marginTop={1}>
          <Text color={palette.amber}>
            {"⚠ "}Press x again to confirm delete · any other key cancels
          </Text>
        </Box>
      ) : (
        (() => {
          const selected = allJobs[selectedIndex];
          if (!selected) return null;
          const hints =
            selected.status === "running"
              ? "x to abort"
              : selected.status === "repairable"
                ? "r to repair sidecar  ·  x to delete"
                : selected.status === "failed" || selected.status === "aborted"
                  ? "r to retry  ·  x to delete"
                  : selected.status === "completed" || selected.status === "completed-with-notes"
                    ? "enter to play  ·  x to delete"
                    : selected.status === "queued"
                      ? "x to remove from queue"
                      : null;
          return hints ? (
            <Box marginTop={1}>
              <Text color={palette.muted} dimColor>
                {hints}
                {failedJobs.some((job) => job.status === "repairable")
                  ? "  ·  a to repair all"
                  : ""}
              </Text>
            </Box>
          ) : null;
        })()
      )}
      {repairSweepStatus ? (
        <Box marginTop={1}>
          <Text color={palette.amber}>{repairSweepStatus}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatEta(job: import("@kunai/storage").DownloadJobRecord): string | null {
  if (job.status !== "running" || !job.startedAt || job.progressPercent < 5) return null;
  const elapsedMs = Date.now() - new Date(job.startedAt).getTime();
  if (elapsedMs < 3_000) return null;
  const totalEstMs = elapsedMs / (job.progressPercent / 100);
  const remainingMs = totalEstMs - elapsedMs;
  if (remainingMs <= 0) return null;
  const remainingS = Math.ceil(remainingMs / 1_000);
  if (remainingS < 60) return `~${remainingS}s left`;
  return `~${Math.ceil(remainingMs / 60_000)}m left`;
}
