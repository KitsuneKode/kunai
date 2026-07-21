import { useConnectivityOnline } from "@/app-shell/hooks/use-connectivity-online";
import { useRailPoster } from "@/app-shell/hooks/use-rail-poster";
import { getPickerChromeRows, getPickerListMaxVisible } from "@/app-shell/layout-policy";
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
import { getWindowStart, truncateLine } from "@/app-shell/shell-text";
import { palette } from "@/app-shell/shell-theme";
import { useDebouncedViewportPolicy } from "@/app-shell/use-viewport-policy";
import { requestUnifiedOfflinePlayback } from "@/app/offline/offline-playback-launch";
import type { Container } from "@/container";
import { createContinuationEngine } from "@/domain/continuation/ContinuationEngine";
import type { OfflineLibraryShelfGroup } from "@/domain/offline/OfflineLibraryEngine";
import { isFinished as isProgressFinished } from "@/services/continuation/history-progress";
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
import { Box, Text, useInput } from "ink";
import React, { useMemo, useState } from "react";

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
  const viewport = useDebouncedViewportPolicy("picker", { zen: container.config.zenMode });
  const networkAvailable = useConnectivityOnline(container.connectivity);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busy, setBusy] = useState(false);

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

  const actionRows: DetailRow[] = useMemo(
    () => [
      {
        kind: "action",
        id: "search-online",
        label: "Continue this title online",
        detail: "Prepare search; no provider work until you submit",
        flatIndex: -1,
      },
      {
        kind: "action",
        id: "download-more",
        label: "Download more episodes",
        detail: "Open the download episode picker for this title",
        flatIndex: -1,
      },
      {
        kind: "action",
        id: "check-integrity",
        label: "Check title integrity",
        detail: "Verify all local artifacts for this title",
        flatIndex: -1,
      },
      {
        kind: "action",
        id: "repair-missing",
        label: "Repair missing items",
        detail: "Queue re-download for broken or missing files",
        flatIndex: -1,
      },
    ],
    [],
  );

  const episodeRows: DetailRow[] = useMemo(
    () =>
      entries.map((entry, index) => ({
        kind: "episode" as const,
        entry,
        flatIndex: index,
      })),
    [entries],
  );

  const flatRows: DetailRow[] = useMemo(
    () => [
      ...episodeRows.map((row, index) => ({ ...row, flatIndex: index })),
      ...actionRows.map((row, index) => ({
        ...row,
        flatIndex: episodeRows.length + index,
      })),
    ],
    [actionRows, episodeRows],
  );

  const totalRows = flatRows.length;
  const safeIndex = totalRows > 0 ? Math.min(selectedIndex, totalRows - 1) : 0;
  const maxVisible = getPickerListMaxVisible(
    viewport.rows,
    getPickerChromeRows({ hasSubtitle: true, commandMode: false, extraRows: 5 }),
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
    (entries[0]?.job ? resolveOfflineJobPreviewImage(entries[0].job) : undefined);
  const { poster: railPoster } = useRailPoster(posterUrl, {
    rows: 12,
    cols: 26,
    enabled: showRail,
  });

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
      if (!key.return || !selectedRow) return;

      void (async () => {
        setBusy(true);
        try {
          if (selectedRow.kind === "episode") {
            const job = selectedRow.entry.job;
            if (job.status !== "completed" && job.status !== "completed-with-notes") {
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
            await requestUnifiedOfflinePlayback(container, job.id);
            return;
          }

          const result = await routeOfflineLibraryGroupAction(container, entries, {
            type: selectedRow.id as
              | "search-online"
              | "download-more"
              | "check-integrity"
              | "repair-missing"
              | "toggle-continuation"
              | "delete-group",
          });
          if (result === "exit") {
            onBack();
            return;
          }
          if (result === "refresh") {
            onEntriesChanged();
          }
        } finally {
          setBusy(false);
        }
      })();
    },
    { isActive: true },
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
          const label = `${offlineStatusIcon(entry.status)} ${formatOfflineJobListingTitle(entry.job)}`;
          const detail = [
            formatOfflineShelfBadge(entry.job, entry.status),
            formatOfflineHistoryProgress(entry.job, historyEntries),
            formatOfflineShelfDetail(entry.job, entry.status),
          ]
            .filter(Boolean)
            .join("  ·  ");
          return (
            <ListRow
              key={entry.job.id}
              selected={selected}
              rowWidth={rowWidth}
              flexColumnIndex={rowLayout.flexColumnIndex}
              columns={buildMediaListRowColumns({
                title: label,
                episodeCode:
                  entry.job.episode !== undefined
                    ? `S${String(entry.job.season ?? 1).padStart(2, "0")}E${String(entry.job.episode).padStart(2, "0")}`
                    : "—",
                statusLabel: detail,
                statusColor: palette.muted,
                statusDim: true,
                layout: rowLayout,
              })}
            />
          );
        }
        return (
          <ListRow
            key={row.id}
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
        );
      })}
      {windowEnd < totalRows ? <Text color={palette.dim}> ▼ ...</Text> : null}
      {windowStart <= episodeRows.length && windowEnd > episodeRows.length ? (
        <SectionGroup label="Actions" marginTop={1} />
      ) : null}
      <Box marginTop={1}>
        <Text color={palette.dim} dimColor>
          {busy ? "Working…" : "↵ play or run action · esc back to titles"}
        </Text>
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
        value: `${group.readyCount} of ${group.entries.length} episodes`,
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
