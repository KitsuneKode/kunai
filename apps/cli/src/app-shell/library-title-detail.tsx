import { useConnectivityOnline } from "@/app-shell/hooks/use-connectivity-online";
import { useRailPoster } from "@/app-shell/hooks/use-rail-poster";
import { getPickerChromeRows, getPickerListMaxVisible } from "@/app-shell/layout-policy";
import { MouseTarget } from "@/app-shell/mouse/MouseRegions";
import {
  buildMediaListRowColumns,
  computeMediaListRowLayout,
} from "@/app-shell/primitives/list-row-layout";
import { ListRow } from "@/app-shell/primitives/ListRow";
import { MediaListShell } from "@/app-shell/primitives/MediaListShell";
import {
  shouldRenderPreviewRail,
  type PreviewRailModel,
} from "@/app-shell/primitives/PreviewRail.model";
import { SectionGroup } from "@/app-shell/primitives/SectionGroup";
import { resolveRootLibraryPlaybackLaunch } from "@/app-shell/root-library-playback-bridge";
import { getWindowStart, truncateLine } from "@/app-shell/shell-text";
import { palette } from "@/app-shell/shell-theme";
import { useDebouncedViewportPolicy } from "@/app-shell/use-viewport-policy";
import { requestUnifiedOfflinePlayback } from "@/app/offline/offline-playback-launch";
import type { Container } from "@/container";
import { createContinuationEngine } from "@/domain/continuation/ContinuationEngine";
import { formatMediaItemCount, presentMedia } from "@/domain/media/media-presentation";
import type { OfflineLibraryShelfGroup } from "@/domain/offline/OfflineLibraryEngine";
import { isFinished as isProgressFinished } from "@/services/continuation/history-progress";
import { parseOfflineTitleCleanupPreference } from "@/services/download/download-cleanup-policy";
import { formatOfflineHistoryProgress } from "@/services/offline/offline-history-progress";
import {
  formatOfflineJobListingTitle,
  formatOfflineShelfBadge,
  formatOfflineShelfDetail,
  offlineStatusIcon,
  resolveOfflineJobPreviewImage,
  type OfflineLibraryEntry,
} from "@/services/offline/offline-library";
import { routeOfflineLibraryGroupAction } from "@/services/offline/offline-library-action-router";
import type { DownloadJobRecord } from "@/services/storage/storage-read-models";
import { Box, Text, useInput } from "ink";
import React, { useMemo, useState } from "react";

import { useRootContentSuspended } from "./RootContentSuspension";

type DetailRow =
  | { readonly kind: "episode"; readonly entry: OfflineLibraryEntry; readonly flatIndex: number }
  | {
      readonly kind: "action";
      readonly id: string;
      readonly label: string;
      readonly detail: string;
    };

export function LibraryTitleDetail({
  container,
  group,
  entries,
  onBack,
  onNavigateToQueue,
  onEntriesChanged,
}: {
  readonly container: Container;
  readonly group: OfflineLibraryShelfGroup;
  readonly entries: readonly OfflineLibraryEntry[];
  readonly onBack: () => void;
  readonly onNavigateToQueue?: () => void;
  readonly onEntriesChanged: () => void;
}) {
  const suspended = useRootContentSuspended();
  const viewport = useDebouncedViewportPolicy("picker", { zen: container.config.zenMode });
  const networkAvailable = useConnectivityOnline(container.connectivity);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  // Bumped after a policy action so the runway and cleanup rows re-render.
  const [, setPolicyRevision] = useState(0);

  const first = entries[0]?.job;
  const historyEntries = useMemo(
    () => (first ? container.historyRepository.listByTitle(first.titleId) : []),
    [container, first],
  );

  const continuationNote = useMemo(() => {
    if (!first) return "";
    return createContinuationEngine().decide({
      titleName: first.titleName,
      networkAvailable,
      localEpisodes: entries
        .filter((entry) => entry.job.season !== undefined && entry.job.episode !== undefined)
        .map((entry) => ({
          season: entry.job.season ?? 1,
          episode: entry.job.episode ?? 1,
          playable: entry.status === "ready",
          completed: historyEntries.some(
            (history) =>
              (history.season ?? 1) === entry.job.season &&
              (history.episode ?? history.absoluteEpisode) === entry.job.episode &&
              isProgressFinished(history),
          ),
        })),
    }).note;
  }, [entries, first, historyEntries, networkAvailable]);

  // Read every render (one keyed row): toggling must relabel the row at once.
  const policyRows = ((): DetailRow[] => {
    if (!first) return [];
    const policy = container.offlineTitlePolicies.get(first.titleId);
    const cleanup = parseOfflineTitleCleanupPreference(policy?.cleanupJson);
    const runway = policy?.runwayTarget ?? container.config.offlineDefaultRunwayTarget;
    // A movie has no next episode to keep ready, so only its cleanup applies.
    const continuation: DetailRow[] =
      group.contentType === "movie"
        ? []
        : [
            {
              kind: "action",
              id: "toggle-continuation",
              // The detail column is narrow; the label carries the meaning.
              label: policy?.enrolled
                ? `Keeping the next ${runway} episodes ready offline`
                : `Keep the next ${runway} episodes ready offline`,
              detail: policy?.enrolled ? "On · ↵ to stop" : "Off · ↵ to start",
            },
          ];
    return [
      ...continuation,
      {
        kind: "action",
        id: "edit-cleanup",
        label:
          cleanup?.mode === "cleanup-watched"
            ? `After watching: suggest cleanup after ${cleanup.graceDays} days`
            : "After watching: keep the latest episode",
        detail: "↵ to change",
      },
    ];
  })();

  const actionRows: DetailRow[] = [
    {
      kind: "action",
      id: "search-online",
      label: "Continue this title online",
      detail: "Prepare search; no provider work until you submit",
    },
    {
      kind: "action",
      id: "download-more",
      label: group.contentType === "movie" ? "Download this movie" : "Download more episodes",
      detail:
        group.contentType === "movie"
          ? "Open title-level download confirmation for this movie"
          : "Open the download episode picker for this title",
    },
    {
      kind: "action",
      id: "check-integrity",
      label: "Check title integrity",
      detail: "Verify all local artifacts for this title",
    },
    {
      kind: "action",
      id: "repair-missing",
      label: "Repair missing items",
      detail: "Queue re-download for broken or missing files",
    },
    ...policyRows,
  ];

  const episodeRows: DetailRow[] = useMemo(
    () =>
      entries.map((entry, index) => ({
        kind: "episode" as const,
        entry,
        flatIndex: index,
      })),
    [entries],
  );

  const flatRows: DetailRow[] = [
    ...episodeRows.map((row, index) => ({ ...row, flatIndex: index })),
    ...actionRows,
  ];

  const totalRows = flatRows.length;
  const safeIndex = totalRows > 0 ? Math.min(selectedIndex, totalRows - 1) : 0;
  const maxVisible = getPickerListMaxVisible(
    viewport.rows,
    getPickerChromeRows({ hasSubtitle: true, commandMode: suspended, extraRows: 5 }),
  );
  const windowStart = getWindowStart(safeIndex, totalRows, maxVisible);
  const windowEnd = Math.min(windowStart + maxVisible, totalRows);
  const visibleRows = flatRows.slice(windowStart, windowEnd);
  const selectedRow = flatRows[safeIndex] ?? null;

  const columns = viewport.columns ?? 80;
  const railWidth = 32;
  const showRail = shouldRenderPreviewRail({ columns, hasModel: true });
  const listWidth = showRail ? Math.max(40, columns - railWidth - 4) : columns;
  const rowWidth = listWidth;
  const rowLayout = computeMediaListRowLayout(rowWidth, { hasEpisode: true });
  const posterUrl =
    group.previewImageUrl ??
    (entries[0]?.job
      ? resolveOfflineJobPreviewImage(entries[0].job, { networkAvailable })
      : undefined);
  const { poster: railPoster } = useRailPoster(posterUrl, {
    rows: 12,
    cols: 26,
    enabled: showRail,
  });

  // Enter and a second tap on the highlighted row run the same thing.
  const runRow = (row: DetailRow): void => {
    if (busy) return;
    void (async () => {
      setBusy(true);
      try {
        if (row.kind === "episode") {
          const job = row.entry.job;
          if (
            job.status !== "completed" &&
            job.status !== "completed-with-notes" &&
            job.status !== "repairable"
          ) {
            return;
          }
          const playable = await container.offlineLibraryService.getPlayableSource(job.id);
          if (playable.status !== "ready") {
            container.stateManager.dispatch({
              type: "SET_PLAYBACK_FEEDBACK",
              note: `Offline file unavailable (${playable.status}). Try integrity check.`,
            });
            return;
          }
          await requestUnifiedOfflinePlayback(container, job.id, {
            onDirectLaunch: resolveRootLibraryPlaybackLaunch,
          });
          return;
        }

        const actionType = row.id as
          | "search-online"
          | "download-more"
          | "check-integrity"
          | "repair-missing"
          | "toggle-continuation"
          | "edit-cleanup"
          | "delete-group";
        const result = await routeOfflineLibraryGroupAction(container, entries, {
          type: actionType,
          ...(actionType === "download-more" ? { contentType: group.contentType } : {}),
        });
        if (result === "exit") {
          onBack();
          return;
        }
        if (result === "refresh") {
          onEntriesChanged();
        }
        if (actionType === "toggle-continuation" || actionType === "edit-cleanup") {
          setPolicyRevision((revision) => revision + 1);
        }
      } finally {
        setBusy(false);
      }
    })();
  };
  // Touch/mouse: the first tap highlights a row, a tap on the highlighted row
  // runs it — the Library list's gesture. The detail had no tap targets, so a
  // touch user who opened a title could not act or get back.
  const tapRow = (flatIndex: number, row: DetailRow): void => {
    if (flatIndex !== safeIndex) setSelectedIndex(flatIndex);
    else runRow(row);
  };
  const wheel = (direction: "up" | "down"): void =>
    setSelectedIndex((prev) =>
      Math.max(0, Math.min(totalRows - 1, prev + (direction === "up" ? -1 : 1))),
    );

  useInput(
    (input, key) => {
      if (key.escape) {
        onBack();
        return;
      }
      if (key.tab || input === "2") {
        onNavigateToQueue?.();
        return;
      }
      if (busy || totalRows === 0) return;
      if (key.upArrow) {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((prev) => Math.min(totalRows - 1, prev + 1));
        return;
      }
      if (key.return && selectedRow) runRow(selectedRow);
    },
    { isActive: !suspended },
  );

  const list = (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginBottom={1} flexDirection="column">
        <Text bold color={palette.text}>
          {group.titleName}
        </Text>
        <Text color={palette.muted}>
          {truncateLine(
            [group.actionSummary, group.artifactSummary, continuationNote]
              .filter(Boolean)
              .join(" · "),
            listWidth,
          )}
        </Text>
      </Box>
      {windowStart > 0 ? <Text color={palette.dim}> ▲ ...</Text> : null}
      {visibleRows.map((row, index) => {
        const flatIndex = windowStart + index;
        const selected = flatIndex === safeIndex;
        if (row.kind === "episode") {
          const { entry } = row;
          const label = `${offlineStatusIcon(entry.status)} ${formatOfflineJobListingTitle(entry.job, group.contentType)}`;
          const detail = [
            formatOfflineShelfBadge(entry.job, entry.status),
            formatOfflineHistoryProgress(entry.job, historyEntries),
            formatOfflineShelfDetail(entry.job, entry.status, group.contentType),
          ]
            .filter(Boolean)
            .join("  ·  ");
          return (
            <MouseTarget
              key={entry.job.id}
              id={`library-detail:row:${entry.job.id}`}
              onClick={() => tapRow(flatIndex, row)}
              onWheel={wheel}
            >
              <ListRow
                selected={selected}
                rowWidth={rowWidth}
                flexColumnIndex={rowLayout.flexColumnIndex}
                columns={buildMediaListRowColumns({
                  title: label,
                  episodeCode: formatLibraryEntryPosition(entry.job, group.contentType),
                  statusLabel: detail,
                  statusColor: palette.muted,
                  statusDim: true,
                  layout: rowLayout,
                })}
              />
            </MouseTarget>
          );
        }
        return (
          <React.Fragment key={row.id}>
            {/* The heading sits above the first action, wherever the window starts. */}
            {flatIndex === episodeRows.length ? (
              <SectionGroup label="Actions" marginTop={1} />
            ) : null}
            <MouseTarget
              id={`library-detail:action:${row.id}`}
              onClick={() => tapRow(flatIndex, row)}
              onWheel={wheel}
            >
              <ListRow
                selected={selected}
                rowWidth={rowWidth}
                flexColumnIndex={rowLayout.flexColumnIndex}
                columns={buildMediaListRowColumns({
                  title: row.label,
                  episodeCode: "—",
                  statusLabel: row.detail,
                  statusColor: palette.dim,
                  statusDim: true,
                  layout: rowLayout,
                })}
              />
            </MouseTarget>
          </React.Fragment>
        );
      })}
      {windowEnd < totalRows ? <Text color={palette.dim}> ▼ ...</Text> : null}
      <Box marginTop={1}>
        <Text color={palette.dim} dimColor>
          {busy ? "Working…" : "↵ play or run action · "}
        </Text>
        {busy ? null : (
          <MouseTarget id="library-detail:back" onClick={onBack}>
            <Text color={palette.accent}>esc back to titles</Text>
          </MouseTarget>
        )}
      </Box>
    </Box>
  );

  const railModel: PreviewRailModel = {
    title: group.titleName,
    subtitle: truncateLine(group.artifactSummary, 40),
    overview: group.detail,
    posterState: group.previewImageUrl ? "ready" : "none",
    facts: [
      {
        label: "offline",
        value: `${group.readyCount} of ${formatMediaItemCount({
          mediaKind: group.mediaKind,
          contentType: group.contentType,
          count: group.entries.length,
        })}`,
        tone: group.readyCount > 0 ? "success" : "warning",
      },
    ],
  };

  return (
    <MediaListShell
      columns={columns}
      listWidth={listWidth}
      railWidth={railWidth}
      list={list}
      railModel={railModel}
      poster={railPoster}
    />
  );
}

/**
 * The compact position column for one downloaded artifact row. A movie or a
 * video has no episode code, so it shows its quiet content-kind label instead
 * of a synthesized season the file does not have.
 */
function formatLibraryEntryPosition(
  job: DownloadJobRecord,
  contentType: DownloadJobRecord["contentType"] = job.contentType,
): string {
  const { positionLabel, kindLabel } = presentMedia({
    title: job.titleName,
    mediaKind: job.mediaKind,
    contentType,
    season: job.season,
    episode: job.episode,
  });
  return positionLabel ?? kindLabel;
}
