import {
  getPickerChromeRows,
  getPickerListMaxVisible,
  ROOT_CHROME_ROWS,
} from "@/app-shell/layout-policy";
import { computeQueueRowLayout } from "@/app-shell/primitives/list-row-layout";
import { ProgressBar } from "@/app-shell/primitives/ProgressBar";
import { StateBlock } from "@/app-shell/primitives/StateBlock";
import { ResizeBlocker } from "@/app-shell/shell-primitives";
import { truncateLine } from "@/app-shell/shell-text";
import { getWindowStart } from "@/app-shell/shell-text";
import { palette } from "@/app-shell/shell-theme";
import { useDebouncedViewportPolicy } from "@/app-shell/use-viewport-policy";
import type { Container } from "@/container";
import type { DownloadJobRecord } from "@kunai/storage";
import { Box, Text, useInput } from "ink";
import React, { useCallback, useEffect, useState } from "react";

/** Fixed queue columns — tuned via computeQueueRowLayout for the active shell width. */

function refreshJobLists(container: Container) {
  return {
    activeJobs: container.downloadService.listActive(50).filter((j) => j.status === "running"),
    queuedJobs: container.downloadService.listActive(50).filter((j) => j.status === "queued"),
    completedJobs: container.downloadService.listCompleted(5),
    failedJobs: container.downloadService.listFailed(10),
  };
}

function queueStatePresentation(job: DownloadJobRecord): { label: string; color: string } {
  if (job.status === "running") return { label: "↓ downloading", color: palette.accent };
  if (job.status === "queued") return { label: "○ queued", color: palette.muted };
  if (job.status === "completed" || job.status === "completed-with-notes") {
    return {
      label: job.status === "completed-with-notes" ? "✓ playable" : "✓ complete",
      color: palette.ok,
    };
  }
  if (job.status === "repairable") {
    return { label: "◇ repairable", color: palette.accent };
  }
  if (job.status === "failed") {
    return { label: "✗ failed", color: palette.danger };
  }
  return { label: "— aborted", color: palette.dim };
}

function queueMetaLine(job: DownloadJobRecord): {
  primary: string;
  secondary?: string;
  tone: string;
} {
  const percent = Math.max(0, Math.min(100, Math.round(job.progressPercent ?? 0)));
  if (job.status === "running" && typeof job.progressPercent === "number") {
    const eta = formatEta(job);
    return {
      primary: `${percent}%`,
      secondary: eta ? `· ${eta}` : undefined,
      tone: palette.accent,
    };
  }
  if (job.status === "queued") {
    const pausedForSpace =
      Boolean(job.nextRetryAt) && Boolean(job.errorMessage?.toLowerCase().includes("space"));
    return {
      primary: "—",
      secondary: pausedForSpace ? "low space" : "waiting",
      tone: palette.dim,
    };
  }
  if (job.status === "completed" || job.status === "completed-with-notes") {
    return {
      primary: job.fileSize ? formatBytes(job.fileSize) : "done",
      tone: palette.muted,
    };
  }
  if (job.status === "failed" || job.status === "repairable") {
    return {
      primary:
        job.status === "repairable"
          ? "sidecar"
          : truncateLine(job.errorMessage ?? "source gone", 12),
      tone: palette.dim,
    };
  }
  return { primary: "—", tone: palette.dim };
}

function progressBarColor(job: DownloadJobRecord): string {
  if (job.status === "completed" || job.status === "completed-with-notes") return palette.okDim;
  if (job.status === "failed" || job.status === "repairable") return palette.dangerDim;
  return palette.accentDeep;
}

function progressBarValue(job: DownloadJobRecord): number {
  if (job.status === "completed" || job.status === "completed-with-notes") return 100;
  if (job.status === "running" && typeof job.progressPercent === "number") {
    return Math.max(0, Math.min(100, job.progressPercent));
  }
  return 0;
}

function QueueSummaryHeader({
  activeCount,
  queuedCount,
  failedCount,
}: {
  readonly activeCount: number;
  readonly queuedCount: number;
  readonly failedCount: number;
}) {
  if (activeCount === 0 && queuedCount === 0 && failedCount === 0) return null;
  return (
    <Box marginBottom={1} gap={2}>
      {activeCount > 0 ? (
        <Text>
          <Text color={palette.accent} bold>
            {activeCount}
          </Text>
          <Text color={palette.muted}> downloading</Text>
        </Text>
      ) : null}
      {queuedCount > 0 ? (
        <Text>
          <Text color={palette.text} bold>
            {queuedCount}
          </Text>
          <Text color={palette.muted}> queued</Text>
        </Text>
      ) : null}
      {failedCount > 0 ? (
        <Text>
          <Text color={palette.danger} bold>
            {failedCount}
          </Text>
          <Text color={palette.muted}> failed</Text>
        </Text>
      ) : null}
    </Box>
  );
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
  showSelectionHints = true,
}: {
  container: Container;
  onClose: () => void;
  onNavigateToLibrary?: () => void;
  /** When false, omit per-selection hint row (parent shell owns the footer). */
  showSelectionHints?: boolean;
}) {
  const viewport = useDebouncedViewportPolicy("picker", { zen: container.config.zenMode });
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
    if (allJobs.length === 0) {
      if (selectedIndex !== 0) setSelectedIndex(0);
      return;
    }
    if (!Number.isFinite(selectedIndex) || selectedIndex < 0 || selectedIndex >= allJobs.length) {
      const nextIndex = Number.isFinite(selectedIndex)
        ? Math.min(Math.max(0, selectedIndex), allJobs.length - 1)
        : 0;
      setSelectedIndex(nextIndex);
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
      if (allJobs.length === 0) return;
      setConfirmingDeleteIndex(null);
      setSelectedIndex((current) => (current - 1 + allJobs.length) % allJobs.length);
      return;
    }
    if (key.downArrow) {
      if (allJobs.length === 0) return;
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
        void import("@/app/offline-playback-launch").then(({ requestUnifiedOfflinePlayback }) =>
          requestUnifiedOfflinePlayback(container, job.id),
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
  const shellWidth = viewport.columns ?? 80;
  const queueLayout = computeQueueRowLayout(shellWidth);

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

  const titleCol = Math.max(
    20,
    shellWidth - 2 - queueLayout.stateWidth - queueLayout.progressWidth - queueLayout.metaWidth - 4,
  );
  const isConfirming = (index: number) =>
    confirmingDeleteIndex === index && selectedIndex === index;

  const renderJob = (job: DownloadJobRecord, index: number) => {
    const isSelected = index === selectedIndex;
    const state = queueStatePresentation(job);
    const meta = queueMetaLine(job);
    const episodeSuffix =
      job.episode !== undefined
        ? ` · S${String(job.season ?? 1).padStart(2, "0")}E${String(job.episode).padStart(2, "0")}`
        : "";
    const titleLine = truncateLine(`${job.titleName}${episodeSuffix}`, titleCol);

    return (
      <Box
        key={job.id}
        flexDirection="column"
        width={shellWidth}
        backgroundColor={isSelected ? palette.surfaceActive : undefined}
      >
        <Box flexDirection="row" width={shellWidth} overflow="hidden">
          <Text color={isSelected ? palette.accent : palette.dim}>{isSelected ? "▌ " : "  "}</Text>
          <Box width={titleCol} overflow="hidden">
            <Text
              wrap="truncate"
              color={isSelected ? palette.text : palette.textDim}
              bold={isSelected}
            >
              {titleLine}
            </Text>
          </Box>
          <Box width={queueLayout.stateWidth} overflow="hidden">
            <Text wrap="truncate" color={state.color}>
              {truncateLine(state.label, queueLayout.stateWidth - 1)}
            </Text>
          </Box>
          <Box width={queueLayout.progressWidth}>
            {job.status === "running" ? (
              <ProgressBar
                value={progressBarValue(job)}
                max={100}
                width={queueLayout.progressWidth - 2}
                color={progressBarColor(job)}
              />
            ) : (
              <Text color={palette.dim} dimColor>
                {" "}
              </Text>
            )}
          </Box>
          <Box
            width={queueLayout.metaWidth}
            flexDirection="row"
            justifyContent="flex-end"
            overflow="hidden"
          >
            <Text wrap="truncate" color={meta.tone} bold={job.status === "running"}>
              {truncateLine(meta.primary, queueLayout.metaWidth - 1)}
            </Text>
            {meta.secondary ? (
              <Text color={palette.dim} dimColor wrap="truncate">
                {" "}
                {truncateLine(meta.secondary, 6)}
              </Text>
            ) : null}
          </Box>
        </Box>
        {isConfirming(index) ? (
          <Box marginLeft={2}>
            <Text color={palette.accentDeep} bold>
              Press x again to remove this download
            </Text>
          </Box>
        ) : null}
      </Box>
    );
  };

  const failedAttentionCount = failedJobs.filter(
    (job) => job.status === "failed" || job.status === "repairable",
  ).length;

  const hasSummaryHeader =
    activeJobs.length > 0 || queuedJobs.length > 0 || failedAttentionCount > 0;
  const hintRows =
    (confirmingDeleteIndex !== null ? 1 : 0) +
    (repairSweepStatus ? 1 : 0) +
    (allJobs.length > 0 ? 1 : 0);
  const chromeRows = getPickerChromeRows({
    hasSubtitle: false,
    commandMode: false,
    extraRows: (hasSummaryHeader ? 1 : 0) + hintRows,
  });
  const maxVisible = getPickerListMaxVisible(viewport.rows, chromeRows, ROOT_CHROME_ROWS + 1);
  const windowStart = getWindowStart(selectedIndex, allJobs.length, maxVisible);
  const windowEnd = Math.min(windowStart + maxVisible, allJobs.length);
  const visibleJobs = allJobs.slice(windowStart, windowEnd);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {allJobs.length === 0 ? (
        <StateBlock
          model={{
            kind: "empty",
            title: "No downloads queued",
            detail:
              "Use /download from a selected title or playback. Kunai confirms the profile before resolving provider streams.",
          }}
        />
      ) : (
        <Box flexDirection="column">
          <QueueSummaryHeader
            activeCount={activeJobs.length}
            queuedCount={queuedJobs.length}
            failedCount={failedAttentionCount}
          />
          {windowStart > 0 ? (
            <Text color={palette.dim} dimColor>
              {"  "}more above
            </Text>
          ) : null}
          {visibleJobs.map((job, index) => renderJob(job, windowStart + index))}
          {windowEnd < allJobs.length ? (
            <Text color={palette.dim} dimColor>
              {"  "}more below
            </Text>
          ) : null}
        </Box>
      )}
      {confirmingDeleteIndex !== null ? (
        <Box marginTop={1}>
          <Text color={palette.accentDeep}>
            {"⚠ "}Press x again to confirm delete · any other key cancels
          </Text>
        </Box>
      ) : showSelectionHints ? (
        (() => {
          const selected = allJobs[selectedIndex];
          if (!selected) return null;
          const hints =
            selected.status === "running"
              ? "x to abort"
              : selected.status === "repairable"
                ? "r to repair subtitle/artwork sidecars  ·  x to delete"
                : selected.status === "failed" || selected.status === "aborted"
                  ? "r to retry  ·  x to delete"
                  : selected.status === "completed" || selected.status === "completed-with-notes"
                    ? "enter to play local file  ·  x to delete"
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
      ) : null}
      {repairSweepStatus ? (
        <Box marginTop={1}>
          <Text color={palette.accentDeep}>{repairSweepStatus}</Text>
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
  if (remainingS < 60) return `${remainingS}s left`;
  return `${Math.ceil(remainingMs / 60_000)}m left`;
}
