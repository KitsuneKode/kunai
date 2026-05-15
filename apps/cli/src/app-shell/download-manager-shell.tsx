import { EmptyState, ResizeBlocker } from "@/app-shell/shell-primitives";
import { truncateLine } from "@/app-shell/shell-text";
import { palette } from "@/app-shell/shell-theme";
import { useDebouncedViewportPolicy } from "@/app-shell/use-viewport-policy";
import type { Container } from "@/container";
import { createSourceSelectionEngine } from "@/domain/playback-source/SourceSelectionEngine";
import type { DownloadJobRecord } from "@kunai/storage";
import { Box, Text, useInput } from "ink";
import React, { useEffect, useState } from "react";

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
}: {
  container: Container;
  onClose: () => void;
}) {
  const viewport = useDebouncedViewportPolicy("picker");
  const [activeJobs, setActiveJobs] = useState<readonly DownloadJobRecord[]>([]);
  const [queuedJobs, setQueuedJobs] = useState<readonly DownloadJobRecord[]>([]);
  const [completedJobs, setCompletedJobs] = useState<readonly DownloadJobRecord[]>([]);
  const [failedJobs, setFailedJobs] = useState<readonly DownloadJobRecord[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    const update = () => {
      setActiveJobs(container.downloadService.listActive(50).filter((j) => j.status === "running"));
      setQueuedJobs(container.downloadService.listActive(50).filter((j) => j.status === "queued"));
      setCompletedJobs(container.downloadService.listCompleted(5));
      setFailedJobs(container.downloadService.listFailed(10));
    };
    update();
    const interval = setInterval(update, 750);
    return () => clearInterval(interval);
  }, [container]);

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
    if (key.upArrow) {
      setSelectedIndex((current) => (current - 1 + allJobs.length) % allJobs.length);
      return;
    }
    if (key.downArrow) {
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
      void container.downloadService.deleteJob(job.id, {
        deleteArtifact: job.status === "failed",
      });
      return;
    }
    if (input === "r" || key.return) {
      const job = allJobs[selectedIndex];
      if (!job) return;

      if (key.return && job.status === "completed") {
        void (async () => {
          const playable = await container.offlineLibraryService.getPlayableSource(job.id);
          if (playable.status !== "ready") return;
          const decision = createSourceSelectionEngine().decide({
            entrypoint: "offline-library",
            local: { status: "ready", jobId: job.id },
            networkAvailable: true,
            preference: "prefer-local",
          });
          const result = await container.player.playLocal({
            source: playable.source,
            attach: false,
            policy: {
              autoSkipEnabled: !container.stateManager.getState().autoskipSessionPaused,
              skipRecap: container.config.skipRecap,
              skipIntro: container.config.skipIntro,
              skipPreview: container.config.skipPreview,
              skipCredits: container.config.skipCredits,
            },
          });
          await container.offlineLibraryService.savePlaybackHistory(playable.source, result);
          container.diagnosticsStore.record({
            category: "playback",
            message: "Offline playback started from unified manager",
            context: {
              jobId: job.id,
              path: job.outputPath,
              sourceDecision: decision.reason,
              shouldResolveOnline: decision.shouldResolveOnline,
            },
          });
        })();
        return;
      }

      if (job.status === "failed" || job.status === "aborted") {
        container.downloadService.retry(job.id);
        void container.downloadService.processQueue();
      }
      return;
    }
  });

  const { tooSmall, minColumns, minRows } = viewport;
  const shellWidth = viewport.columns;

  if (tooSmall) {
    return <ResizeBlocker minColumns={minColumns} minRows={minRows} />;
  }

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
            : job.status === "failed"
              ? "✗ failed"
              : "— aborted";
    const progressMeta =
      job.status === "running"
        ? [
            job.fileSize ? `${formatBytes(job.fileSize)}` : null,
            job.attempt > 0 ? `try ${job.attempt}` : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : job.status === "completed"
          ? [
              job.completedAt ? new Date(job.completedAt).toLocaleDateString() : null,
              job.subtitlePath ? "subs" : job.subtitleUrl ? "no subs" : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : job.status === "failed"
            ? truncateLine(job.errorMessage ?? "Failed", 28)
            : job.status;
    const nameStr = `${job.titleName}${job.episode ? ` S${String(job.season ?? 1).padStart(2, "0")}E${String(job.episode).padStart(2, "0")}` : ""}`;
    const statusColor =
      job.status === "running"
        ? palette.green
        : job.status === "completed"
          ? palette.green
          : job.status === "failed"
            ? palette.red
            : job.status === "aborted"
              ? palette.muted
              : palette.amber;
    return (
      <Box key={job.id} flexDirection="row">
        <Text color={isSelected ? palette.teal : palette.gray}>{isSelected ? "❯ " : "  "}</Text>
        <Box width={shellWidth > 80 ? 40 : 25}>
          <Text color={isSelected ? "white" : undefined} bold={isSelected}>
            {truncateLine(nameStr, shellWidth > 80 ? 38 : 23)}
          </Text>
        </Box>
        <Box width={28}>
          <Text color={statusColor}>{progressCore}</Text>
        </Box>
        <Box flexGrow={1}>
          <Text color={palette.muted} dimColor>
            {progressMeta}
          </Text>
        </Box>
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
        <Text color={color}>
          {"─── "}
          {title.toUpperCase()} ({jobs.length})
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
            "✗ Failed",
            failedJobs,
            activeJobs.length + queuedJobs.length + completedJobs.length,
            palette.red,
          )}
        </Box>
      )}
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
