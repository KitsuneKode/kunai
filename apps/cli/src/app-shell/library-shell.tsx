import { DownloadManagerContent } from "@/app-shell/download-manager-shell";
import { useRailPoster } from "@/app-shell/hooks/use-rail-poster";
import { getPickerChromeRows, getPickerListMaxVisible } from "@/app-shell/layout-policy";
import { LibraryTitleDetail } from "@/app-shell/library-title-detail";
import { libraryFooterActions, queueFooterActions } from "@/app-shell/overlay-footer-actions";
import { ClaudeTabRow } from "@/app-shell/primitives/ClaudeTabRow";
import {
  buildMediaListRowColumns,
  computeMediaListRowLayout,
} from "@/app-shell/primitives/list-row-layout";
import { ListRow } from "@/app-shell/primitives/ListRow";
import { MediaListShell } from "@/app-shell/primitives/MediaListShell";
import {
  shouldRenderPreviewRail,
  type PreviewFact,
  type PreviewRailModel,
} from "@/app-shell/primitives/PreviewRail.model";
import { ResumeCard } from "@/app-shell/primitives/ResumeCard";
import { SectionGroup } from "@/app-shell/primitives/SectionGroup";
import { StateBlock } from "@/app-shell/primitives/StateBlock";
import { ResizeBlocker, ShellFooter, selectFooterActions } from "@/app-shell/shell-primitives";
import { getWindowStart, truncateLine } from "@/app-shell/shell-text";
import { palette } from "@/app-shell/shell-theme";
import { useDebouncedViewportPolicy } from "@/app-shell/use-viewport-policy";
import type { Container } from "@/container";
import type { OfflineLibraryShelfGroup } from "@/domain/offline/OfflineLibraryEngine";
import { createOfflineLibraryEngine } from "@/domain/offline/OfflineLibraryEngine";
import {
  historyContentType,
  isFinished,
  readLatestHistoryByTitle,
} from "@/services/continuation/history-progress";
import type { HistoryProgress } from "@/services/storage/storage-read-models";
import type { ListItem } from "@/services/storage/storage-read-models";
import { Box, Text, useInput } from "ink";
import React, { useEffect, useMemo, useState } from "react";

type TabId = "library" | "queue";

type LibraryShelfSection = "in-progress" | "downloaded" | "saved";

type LibraryShelfRow =
  | { readonly kind: "offline"; readonly group: OfflineLibraryShelfGroup }
  | { readonly kind: "saved"; readonly item: ListItem };

type LibraryRenderItem =
  | { readonly kind: "section"; readonly label: string }
  | {
      readonly kind: "row";
      readonly row: LibraryShelfRow;
      readonly flatIndex: number;
      readonly selected: boolean;
    };

const SHELF_SECTION_ORDER: readonly {
  readonly key: LibraryShelfSection;
  readonly label: string;
}[] = [
  { key: "in-progress", label: "In progress" },
  { key: "downloaded", label: "Downloaded" },
  { key: "saved", label: "Saved" },
];

export function LibraryShell({
  container,
  onClose,
  initialView = "library",
}: {
  container: Container;
  onClose: () => void;
  initialView?: TabId;
}) {
  const [tab, setTab] = useState<TabId>(initialView);
  const [downloadsEnabledOverride, setDownloadsEnabledOverride] = useState<boolean | null>(null);
  const downloadsEnabled = downloadsEnabledOverride ?? container.config.downloadsEnabled;
  const viewport = useDebouncedViewportPolicy("picker", { zen: container.config.zenMode });

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.tab) {
      setTab((prev) => (prev === "library" ? "queue" : "library"));
      return;
    }
    if (input === "1" || input === "l") {
      setTab("library");
      return;
    }
    if (input === "2") {
      setTab("queue");
      return;
    }
    if (input === "d" || input === "D") {
      const next = !downloadsEnabled;
      setDownloadsEnabledOverride(next);
      void container.config.update({ downloadsEnabled: next });
      void container.config.save();
      return;
    }
  });

  if (viewport.tooSmall) {
    return (
      <ResizeBlocker
        columns={viewport.columns}
        rows={viewport.rows}
        minColumns={viewport.minColumns}
        minRows={viewport.minRows}
      />
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <ClaudeTabRow
        labels={["Library", "Queue"]}
        activeIndex={tab === "library" ? 0 : 1}
        hint="Tab switch"
      />
      <Text color={palette.dim} dimColor>
        {downloadsEnabled ? "downloads on" : "downloads off"} · runway: title opt-in
      </Text>

      <Box marginTop={1} flexDirection="column" flexGrow={1}>
        {tab === "queue" ? (
          <DownloadManagerContent
            container={container}
            onClose={onClose}
            onNavigateToLibrary={() => setTab("library")}
            showSelectionHints={false}
          />
        ) : (
          <LibraryTab container={container} />
        )}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <ShellFooter
          taskLabel={tab === "library" ? "Library" : "Queue"}
          mode="minimal"
          actions={selectFooterActions(
            tab === "library" ? libraryFooterActions() : queueFooterActions(),
            "minimal",
            viewport.columns,
          )}
          terminalWidth={viewport.columns}
        />
        {tab === "library" ? (
          <Text color={palette.dim} dimColor>
            Missing or broken artifacts: press <Text color={palette.accent}>x</Text> to remove, then
            re-add via <Text color={palette.accent}>/download</Text>.
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}

type LibraryView = "titles" | "title-detail";

function LibraryTab({ container }: { container: Container }) {
  const [libraryView, setLibraryView] = useState<LibraryView>("titles");
  const [detailGroup, setDetailGroup] = useState<OfflineLibraryShelfGroup | null>(null);
  const [entries, setEntries] = useState<
    readonly import("@/services/offline/offline-library").OfflineLibraryEntry[] | null
  >(null);
  const [watchlist, setWatchlist] = useState<readonly ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const [historyMap, setHistoryMap] = useState<Record<string, HistoryProgress>>({});
  const [filterQuery, setFilterQuery] = useState("");
  const viewport = useDebouncedViewportPolicy("picker", { zen: container.config.zenMode });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [result, history] = await Promise.all([
          container.offlineLibraryService.listCompletedEntries(200),
          Promise.resolve(readLatestHistoryByTitle(container.historyRepository)),
        ]);
        if (cancelled) return;
        setEntries(result);
        setHistoryMap(history);
        setWatchlist(container.listService.getWatchlist());
        setLoadError(null);
        setLoading(false);
      } catch (error: unknown) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [container]);

  const shelf = entries ? createOfflineLibraryEngine().buildShelf(entries) : null;
  const protectedIds = useMemo(
    () => new Set(container.config.protectedDownloadJobIds),
    [container.config.protectedDownloadJobIds],
  );

  const flatRows = useMemo(() => {
    if (!shelf) return [];
    const rows = buildLibraryFlatRows(shelf.groups, watchlist, historyMap);
    const normalized = filterQuery.trim().toLowerCase();
    if (!normalized) return rows;
    return rows.filter((row) => {
      if (row.kind === "offline") {
        return row.group.titleName.toLowerCase().includes(normalized);
      }
      return row.item.title.toLowerCase().includes(normalized);
    });
  }, [shelf, watchlist, historyMap, filterQuery]);
  const sections = useMemo(
    () => (shelf ? buildLibraryShelfSections(shelf.groups, watchlist, historyMap) : []),
    [shelf, watchlist, historyMap],
  );

  const totalRows = flatRows.length;
  const safeIndex = totalRows > 0 ? Math.min(selectedIndex, totalRows - 1) : 0;
  const maxVisible = getPickerListMaxVisible(
    viewport.rows,
    getPickerChromeRows({ hasSubtitle: false, commandMode: false, extraRows: 4 }),
  );
  const windowStart = getWindowStart(safeIndex, totalRows, maxVisible);
  const windowEnd = Math.min(windowStart + maxVisible, totalRows);
  const items = buildVisibleLibraryItems(sections, flatRows, safeIndex, windowStart, windowEnd);
  const showScrollUp = windowStart > 0;
  const showScrollDown = windowEnd < totalRows;
  const selectedRow = totalRows > 0 ? flatRows[safeIndex] : null;
  const selectedOfflineGroup = selectedRow?.kind === "offline" ? selectedRow.group : null;

  const detailEntries = useMemo(() => {
    if (!detailGroup || !entries) return [];
    return entries.filter((entry) => entry.job.titleId === detailGroup.titleId);
  }, [detailGroup, entries]);

  const refreshEntries = () => {
    void (async () => {
      const result = await container.offlineLibraryService.listCompletedEntries(200);
      setEntries(result);
      if (detailGroup && !result.some((entry) => entry.job.titleId === detailGroup.titleId)) {
        setLibraryView("titles");
        setDetailGroup(null);
      }
    })();
  };

  useInput((input, key) => {
    if (libraryView === "title-detail") return;
    if (loading || !entries) return;
    if (key.backspace || input === "\b") {
      setFilterQuery((query) => query.slice(0, -1));
      return;
    }
    if (input === "\u001b") return;
    if (
      input.length === 1 &&
      !key.ctrl &&
      !key.meta &&
      !key.return &&
      !key.escape &&
      !key.upArrow &&
      !key.downArrow &&
      !key.tab &&
      input !== "x" &&
      input !== "X" &&
      input !== "p" &&
      input !== "P"
    ) {
      setFilterQuery((query) => query + input);
      return;
    }
    if (totalRows === 0) return;
    // Esc cancels an armed delete-confirm first (web-routing back: undo the
    // pending state before leaving the surface). Only when nothing is armed does
    // esc fall through to the root overlay, which closes the Library.
    if (key.escape && confirmDeleteKey) {
      setConfirmDeleteKey(null);
      return;
    }
    if (key.upArrow) {
      setConfirmDeleteKey(null);
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setConfirmDeleteKey(null);
      setSelectedIndex((prev) => Math.min(totalRows - 1, prev + 1));
      return;
    }
    if (input === "x" || key.delete) {
      if (!selectedOfflineGroup) return;
      if (confirmDeleteKey === selectedOfflineGroup.key) {
        setConfirmDeleteKey(null);
        const groupEntryIds: string[] = [];
        for (const entry of entries) {
          if (entry.job.titleId === selectedOfflineGroup.titleId) groupEntryIds.push(entry.job.id);
        }
        for (const jobId of groupEntryIds) {
          container.downloadService.deleteJob(jobId, { deleteArtifact: true });
        }
        setEntries((prev) =>
          prev ? prev.filter((e) => e.job.titleId !== selectedOfflineGroup.titleId) : null,
        );
      } else {
        setConfirmDeleteKey(selectedOfflineGroup.key);
      }
      return;
    }
    if (input === "p" || input === "P") {
      if (!selectedOfflineGroup) return;
      const groupEntryIds: string[] = [];
      for (const entry of entries) {
        if (entry.job.titleId === selectedOfflineGroup.titleId) groupEntryIds.push(entry.job.id);
      }
      const protectedSet = new Set(container.config.protectedDownloadJobIds);
      const allProtected = groupEntryIds.every((id) => protectedSet.has(id));
      void (async () => {
        const updated = new Set(container.config.protectedDownloadJobIds);
        for (const jobId of groupEntryIds) {
          if (allProtected) updated.delete(jobId);
          else updated.add(jobId);
        }
        await container.config.update({ protectedDownloadJobIds: [...updated] });
        await container.config.save();
      })();
      container.stateManager.dispatch({
        type: "SET_PLAYBACK_FEEDBACK",
        note: allProtected
          ? `Removed cleanup protection: ${selectedOfflineGroup.titleName}`
          : `Protected from cleanup: ${selectedOfflineGroup.titleName}`,
      });
      return;
    }
    if (key.return) {
      if (!selectedOfflineGroup) return;
      setDetailGroup(selectedOfflineGroup);
      setLibraryView("title-detail");
      return;
    }
    if (confirmDeleteKey !== null) {
      setConfirmDeleteKey(null);
    }
  });

  const railPosterUrl =
    libraryView === "titles" && selectedOfflineGroup
      ? buildLibraryPreviewRailModel(selectedOfflineGroup, historyMap, entries ?? [], protectedIds)
          .posterUrl
      : undefined;
  const { poster: railPoster } = useRailPoster(railPosterUrl, {
    rows: 12,
    cols: 26,
    enabled:
      libraryView === "titles" &&
      !loading &&
      !loadError &&
      Boolean(entries) &&
      (viewport.columns ?? 80) >= 124,
  });

  if (loading) {
    return (
      <Box flexDirection="column" flexGrow={1} justifyContent="center">
        <StateBlock
          model={{
            kind: "loading",
            title: "Loading offline library",
            detail: "Reading completed downloads and resume positions.",
          }}
        />
      </Box>
    );
  }

  if (loadError) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <StateBlock
          model={{
            kind: "error",
            title: "Offline library unavailable",
            detail: loadError,
          }}
        />
      </Box>
    );
  }

  if ((!entries || entries.length === 0) && watchlist.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <StateBlock
          model={{
            kind: "empty",
            title: "No offline titles yet",
            detail: "Queue downloads from playback with / → Download current episode.",
          }}
        />
        <Box marginTop={1}>
          <Text color={palette.muted} dimColor>
            Switch to Queue (Tab) to see active downloads
          </Text>
        </Box>
      </Box>
    );
  }

  if (!shelf) return null;

  if (libraryView === "title-detail" && detailGroup) {
    return (
      <LibraryTitleDetail
        container={container}
        group={detailGroup}
        entries={detailEntries}
        onBack={() => {
          setLibraryView("titles");
          setDetailGroup(null);
        }}
        onEntriesChanged={refreshEntries}
      />
    );
  }

  const columns = viewport.columns ?? 80;
  const railWidth = 32;
  const showRail = shouldRenderPreviewRail({
    columns,
    hasModel: selectedOfflineGroup !== null,
  });
  const listWidth = showRail ? Math.max(40, columns - railWidth - 4) : columns;
  const rowWidth = listWidth;
  const rowLayout = computeMediaListRowLayout(rowWidth, { hasEpisode: true });

  const list = (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginBottom={1}>
        <Text color={palette.dim}>{shelf.summary}</Text>
      </Box>
      {filterQuery.length > 0 ? (
        <Box marginBottom={1}>
          <Text color={palette.accent}>Filter: </Text>
          <Text color={palette.text} bold>
            {filterQuery}
          </Text>
        </Box>
      ) : null}
      {showScrollUp ? <Text color={palette.dim}> ▲ ...</Text> : null}
      {items.map((item) => {
        if (item.kind === "section") {
          return <SectionGroup key={`section-${item.label}`} label={item.label} marginTop={1} />;
        }
        const { row, selected } = item;
        const title =
          row.kind === "offline"
            ? formatLibraryTitle(
                row.group,
                isLibraryGroupProtected(row.group, entries ?? [], protectedIds),
              )
            : row.item.title;
        const ep =
          row.kind === "offline"
            ? formatLibrarySeasonCode(row.group)
            : formatSavedSeasonCode(row.item);
        const status = formatLibraryStatus(row, historyMap);
        return (
          <ListRow
            key={
              row.kind === "offline" ? row.group.key : `saved-${row.item.titleId}-${row.item.id}`
            }
            selected={selected}
            rowWidth={rowWidth}
            flexColumnIndex={rowLayout.flexColumnIndex}
            columns={buildMediaListRowColumns({
              title,
              episodeCode: ep,
              statusLabel: status.label,
              statusColor: status.color,
              statusDim: status.dim,
              layout: rowLayout,
            })}
          />
        );
      })}
      {showScrollDown ? <Text color={palette.dim}> ▼ ...</Text> : null}
      {selectedOfflineGroup && confirmDeleteKey === selectedOfflineGroup.key ? (
        <Box marginTop={1}>
          <Text color={palette.accentDeep}>
            {"⚠ "}Press x again to delete {selectedOfflineGroup.titleName} and all local files
          </Text>
        </Box>
      ) : null}
      {selectedOfflineGroup && confirmDeleteKey !== selectedOfflineGroup.key ? (
        <ResumeCard
          label={
            selectedOfflineGroup.nextPlayableEpisodeLabel
              ? `▸ Resume ${selectedOfflineGroup.nextPlayableEpisodeLabel} offline`
              : `▸ Open ${selectedOfflineGroup.titleName}`
          }
          action="↵ enter"
          width={Math.min(rowWidth, 56)}
        />
      ) : null}
    </Box>
  );

  const railModel =
    selectedOfflineGroup !== null
      ? buildLibraryPreviewRailModel(selectedOfflineGroup, historyMap, entries ?? [], protectedIds)
      : null;

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

function libraryRowKey(row: LibraryShelfRow): string {
  return row.kind === "offline" ? row.group.key : `saved:${row.item.titleId}`;
}

function buildLibraryFlatRows(
  groups: readonly OfflineLibraryShelfGroup[],
  watchlist: readonly ListItem[],
  historyMap: Record<string, HistoryProgress>,
): LibraryShelfRow[] {
  const sections = buildLibraryShelfSections(groups, watchlist, historyMap);
  return sections.flatMap((section) => section.rows);
}

function buildLibraryShelfSections(
  groups: readonly OfflineLibraryShelfGroup[],
  watchlist: readonly ListItem[],
  historyMap: Record<string, HistoryProgress>,
): { label: string; rows: LibraryShelfRow[] }[] {
  const offlineTitleIds = new Set(groups.map((group) => group.titleId));
  const savedOnly: LibraryShelfRow[] = [];
  for (const item of watchlist) {
    if (!offlineTitleIds.has(item.titleId)) {
      savedOnly.push({ kind: "saved", item });
    }
  }

  const buckets: Record<LibraryShelfSection, LibraryShelfRow[]> = {
    "in-progress": [],
    downloaded: [],
    saved: savedOnly,
  };

  for (const group of groups) {
    buckets[classifyLibrarySection(group, historyMap)].push({ kind: "offline", group });
  }

  return SHELF_SECTION_ORDER.map(({ key, label }) => ({
    label,
    rows: buckets[key],
  })).filter((section) => section.rows.length > 0);
}

function buildVisibleLibraryItems(
  sections: readonly { label: string; rows: readonly LibraryShelfRow[] }[],
  flatRows: readonly LibraryShelfRow[],
  selectedIndex: number,
  windowStart: number,
  windowEnd: number,
): LibraryRenderItem[] {
  const visibleKeys = new Set(
    flatRows.slice(windowStart, windowEnd).map((row) => libraryRowKey(row)),
  );
  const items: LibraryRenderItem[] = [];
  for (const section of sections) {
    const visibleRows = section.rows.filter((row) => visibleKeys.has(libraryRowKey(row)));
    if (visibleRows.length === 0) continue;
    items.push({ kind: "section", label: section.label });
    for (const row of visibleRows) {
      const flatIndex = flatRows.findIndex(
        (candidate) => libraryRowKey(candidate) === libraryRowKey(row),
      );
      items.push({
        kind: "row",
        row,
        flatIndex,
        selected: flatIndex === selectedIndex,
      });
    }
  }
  return items;
}

function classifyLibrarySection(
  group: OfflineLibraryShelfGroup,
  historyMap: Record<string, HistoryProgress>,
): LibraryShelfSection {
  const hist = historyMap[group.titleId];
  if (hist && !isFinished(hist) && hist.positionSeconds > 30) {
    const duration = hist.durationSeconds ?? 0;
    const pct = duration > 0 ? (hist.positionSeconds / duration) * 100 : 0;
    if (pct > 0 && pct < 95) return "in-progress";
  }
  if (group.readyCount > 0) return "downloaded";
  return "saved";
}

function isLibraryGroupProtected(
  group: OfflineLibraryShelfGroup,
  entries: readonly import("@/services/offline/offline-library").OfflineLibraryEntry[],
  protectedIds: ReadonlySet<string>,
): boolean {
  return entries
    .filter((entry) => entry.job.titleId === group.titleId)
    .some((entry) => protectedIds.has(entry.job.id));
}

function formatLibraryTitle(group: OfflineLibraryShelfGroup, protectedTitle: boolean): string {
  const shield = protectedTitle ? " ⚲" : "";
  const downloaded =
    group.readyCount > 0 && group.entries.length > 0
      ? ` ↓ ${group.readyCount}/${group.entries.length}`
      : "";
  return `${group.titleName}${downloaded}${shield}`;
}

function formatLibrarySeasonCode(group: OfflineLibraryShelfGroup): string {
  const seasons = new Set(
    group.entries
      .map((entry) => entry.episodeLabel.match(/^S(\d+)/)?.[1])
      .filter((value): value is string => Boolean(value)),
  );
  if (seasons.size === 1) {
    const season = [...seasons][0];
    return season ? `S${season}` : "—";
  }
  if (group.entries.length === 1) return group.entries[0]?.episodeLabel ?? "—";
  return "—";
}

function formatSavedSeasonCode(item: ListItem): string {
  if (typeof item.season === "number") return `S${String(item.season).padStart(2, "0")}`;
  return "—";
}

function formatLibraryStatus(
  row: LibraryShelfRow,
  historyMap: Record<string, HistoryProgress>,
): { label: string; color: string; dim: boolean } {
  if (row.kind === "saved") {
    return { label: "◆ saved", color: palette.dim, dim: true };
  }
  const { group } = row;
  const hist = historyMap[group.titleId];
  if (hist && !isFinished(hist) && (hist.durationSeconds ?? 0) > 0) {
    const pct = Math.round((hist.positionSeconds / (hist.durationSeconds ?? 0)) * 100);
    if (pct > 0 && pct < 95) {
      return { label: `▸ ${pct}%`, color: palette.accent, dim: false };
    }
  }
  if (group.readyCount > 0) {
    return {
      label: `↓ ${group.readyCount} ${group.readyCount === 1 ? "ep" : "ep"}`,
      color: palette.ok,
      dim: false,
    };
  }
  if (group.issueCount > 0) {
    return { label: `${group.issueCount}⚠`, color: palette.accentDeep, dim: false };
  }
  return { label: "◆ saved", color: palette.dim, dim: true };
}

function buildLibraryPreviewRailModel(
  group: OfflineLibraryShelfGroup,
  historyMap: Record<string, HistoryProgress>,
  entries: readonly import("@/services/offline/offline-library").OfflineLibraryEntry[],
  protectedIds: ReadonlySet<string>,
): PreviewRailModel {
  const hist = historyMap[group.titleId];
  const protectedTitle = isLibraryGroupProtected(group, entries, protectedIds);
  const sizeBytes = entries
    .filter((entry) => entry.job.titleId === group.titleId)
    .reduce((sum, entry) => sum + (entry.job.fileSize ?? 0), 0);
  const sizeLabel =
    sizeBytes >= 1_073_741_824
      ? `${(sizeBytes / 1_073_741_824).toFixed(1)} GB`
      : sizeBytes > 0
        ? `${(sizeBytes / 1_048_576).toFixed(1)} MB`
        : "—";

  const facts: PreviewFact[] = [
    {
      label: "offline",
      value: `${group.readyCount} of ${group.entries.length} episodes`,
      tone: group.readyCount > 0 ? "success" : "warning",
    },
    {
      label: "size",
      value: sizeLabel,
      tone: "muted",
    },
  ];

  if (hist && !isFinished(hist) && (hist.durationSeconds ?? 0) > 0) {
    const pct = Math.round((hist.positionSeconds / (hist.durationSeconds ?? 0)) * 100);
    const ep =
      historyContentType(hist) === "series"
        ? `E${String(hist.episode ?? hist.absoluteEpisode ?? 1).padStart(2, "0")}`
        : "movie";
    facts.push({
      label: "progress",
      value: `${ep} · ${pct}%`.trim(),
      tone: "warning",
    });
  }

  facts.push({
    label: "protected",
    value: protectedTitle ? "yes" : "no",
    tone: protectedTitle ? "success" : "muted",
  });

  return {
    title: group.titleName,
    subtitle: truncateLine(group.artifactSummary, 40),
    overview: group.detail,
    posterState: group.previewImageUrl ? "ready" : "none",
    posterUrl: group.previewImageUrl,
    facts,
  };
}
