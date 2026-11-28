import { DownloadManagerContent } from "@/app-shell/download-manager-shell";
import { useConnectivityOnline } from "@/app-shell/hooks/use-connectivity-online";
import { useRailPoster } from "@/app-shell/hooks/use-rail-poster";
import { getPickerChromeRows, getPickerListMaxVisible } from "@/app-shell/layout-policy";
import {
  armLibraryDeletion,
  executeLibraryDeletion,
  refreshLibraryEntries,
  toggleLibraryCleanupProtection,
} from "@/app-shell/library-offline-actions";
import { libraryResumeCardCopy } from "@/app-shell/library-resume-card-copy";
import {
  buildLibraryFlatRows,
  buildLibraryShelfSections,
  libraryRowKey,
  type LibraryShelfRow,
  type LibraryShelfSection,
} from "@/app-shell/library-shelf-model";
import { LibraryTitleDetail } from "@/app-shell/library-title-detail";
import {
  buildLibraryPreviewRailModel,
  formatLibrarySeasonCode,
  formatLibraryStatus,
  formatLibraryTitle,
  isLibraryGroupProtected,
  selectOfflineGroupEntries,
} from "@/app-shell/library-view-model";
import { MouseTarget } from "@/app-shell/mouse/MouseRegions";
import {
  libraryFooterActions,
  downloadQueueFooterActions,
} from "@/app-shell/overlay-footer-actions";
import { plainModeEnabled } from "@/app-shell/plain-mode";
import { ClaudeTabRow } from "@/app-shell/primitives/ClaudeTabRow";
import { ConfirmStrip } from "@/app-shell/primitives/ConfirmStrip";
import {
  confirmStripFooterActions,
  confirmStripOwnsInput,
} from "@/app-shell/primitives/ConfirmStrip.model";
import {
  buildMediaListRowColumns,
  computeMediaListRowLayout,
} from "@/app-shell/primitives/list-row-layout";
import { ListRow } from "@/app-shell/primitives/ListRow";
import { MediaListShell } from "@/app-shell/primitives/MediaListShell";
import { shouldRenderPreviewRail } from "@/app-shell/primitives/PreviewRail.model";
import { ResumeCard } from "@/app-shell/primitives/ResumeCard";
import { SectionGroup } from "@/app-shell/primitives/SectionGroup";
import { StateBlock } from "@/app-shell/primitives/StateBlock";
import {
  useConfirmStripController,
  type ConfirmStripController,
} from "@/app-shell/primitives/use-confirm-strip";
import { ResizeBlocker, ShellFooter, selectFooterActions } from "@/app-shell/shell-primitives";
import { getWindowStart } from "@/app-shell/shell-text";
import { palette } from "@/app-shell/shell-theme";
import { useDebouncedViewportPolicy } from "@/app-shell/use-viewport-policy";
import type { Container } from "@/container";
import type { OfflineLibraryShelfGroup } from "@/domain/offline/OfflineLibraryEngine";
import { createOfflineLibraryEngine } from "@/domain/offline/OfflineLibraryEngine";
import { readLatestHistoryByTitle } from "@/services/continuation/history-progress";
import type { HistoryProgress } from "@/services/storage/storage-read-models";
import { Box, Text, useInput } from "ink";
import React, { useEffect, useMemo, useRef, useState } from "react";

import { resolveEscStack, type EscLayer } from "./esc-stack";
import { routeListFilterKey } from "./list-filter-keys";
import { useRootContentSuspended } from "./RootContentSuspension";

export { libraryResumeCardCopy } from "@/app-shell/library-resume-card-copy";

type TabId = "library" | "queue";

type LibraryRenderItem =
  | { readonly kind: "section"; readonly label: string }
  | {
      readonly kind: "row";
      readonly row: LibraryShelfRow;
      readonly flatIndex: number;
      readonly selected: boolean;
    };

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
  const libraryConfirm = useConfirmStripController();
  const downloadConfirm = useConfirmStripController();
  const activeConfirm = tab === "library" ? libraryConfirm : downloadConfirm;
  const [downloadJobCount, setDownloadJobCount] = useState(0);
  const [libraryRowCount, setLibraryRowCount] = useState(0);
  const downloadsEnabled = container.config.downloadsEnabled;
  const viewport = useDebouncedViewportPolicy("picker", { zen: container.config.zenMode });

  useEffect(() => {
    const refreshCount = () => {
      const active = container.downloadService.listActive(50).length;
      const completed = container.downloadService.listCompleted(5).length;
      const failed = container.downloadService.listFailed(10).length;
      setDownloadJobCount(active + completed + failed);
    };
    refreshCount();
    return container.downloadService.onEvent(() => {
      refreshCount();
    });
  }, [container]);

  // Input ownership is structural: only the mounted child surface owns keys.
  // LibraryShell itself does not register useInput.

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
        labels={["Library", "Downloads"]}
        activeIndex={tab === "library" ? 0 : 1}
        hint="Tab switch"
        pointer={{ id: "library", select: (index) => setTab(index === 0 ? "library" : "queue") }}
      />
      <Text color={palette.dim} dimColor>
        {downloadsEnabled ? "downloads on" : "downloads off"} · runway: title opt-in
      </Text>

      <Box marginTop={1} flexDirection="column">
        {tab === "queue" ? (
          <DownloadManagerContent
            container={container}
            onClose={onClose}
            onNavigateToLibrary={() => setTab("library")}
            showSelectionHints={false}
            confirmController={downloadConfirm}
          />
        ) : (
          <LibraryTab
            container={container}
            onClose={onClose}
            onNavigateToQueue={() => setTab("queue")}
            onRowCountChange={setLibraryRowCount}
            confirmController={libraryConfirm}
          />
        )}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <ShellFooter
          taskLabel={tab === "library" ? "Library" : downloadJobCount > 0 ? "Downloads" : "Queue"}
          mode="minimal"
          actions={
            confirmStripOwnsInput(activeConfirm.state)
              ? confirmStripFooterActions(activeConfirm.state)
              : selectFooterActions(
                  tab === "library"
                    ? libraryFooterActions({ hasRows: libraryRowCount > 0 })
                    : downloadQueueFooterActions({ hasJobs: downloadJobCount > 0 }),
                  "minimal",
                  viewport.columns,
                )
          }
          terminalWidth={viewport.columns}
          companionHint
        />
        {tab === "library" ? (
          <Text color={palette.dim} dimColor>
            Missing or broken artifacts: press <Text color={palette.accent}>x</Text> to remove, then
            re-add via <Text color={palette.accent}>/download</Text>.
          </Text>
        ) : downloadJobCount === 0 ? (
          <Text color={palette.dim} dimColor>
            Queue empty · use <Text color={palette.accent}>/download</Text> from a title · Esc
            closes
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}

type LibraryView = "titles" | "title-detail";

/** Row actions on a title list with no filter in progress: delete, protect, Downloads tab, undo. */
const LIBRARY_ACTION_KEYS: ReadonlySet<string> = new Set(["x", "X", "p", "P", "2", "z"]);

function LibraryTab({
  container,
  onClose,
  onNavigateToQueue,
  onRowCountChange,
  confirmController,
}: {
  container: Container;
  onClose: () => void;
  onNavigateToQueue: () => void;
  onRowCountChange: (count: number) => void;
  confirmController: ConfirmStripController;
}) {
  const confirm = confirmController;
  const suspended = useRootContentSuspended();
  const [libraryView, setLibraryView] = useState<LibraryView>("titles");
  const [detailGroup, setDetailGroup] = useState<OfflineLibraryShelfGroup | null>(null);
  const [entries, setEntries] = useState<
    readonly import("@/services/offline/offline-library").OfflineLibraryEntry[] | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [historyMap, setHistoryMap] = useState<Record<string, HistoryProgress>>({});
  const [filterQuery, setFilterQuery] = useState("");
  const [filterFocused, setFilterFocused] = useState(false);
  const viewport = useDebouncedViewportPolicy("picker", { zen: container.config.zenMode });
  const titlesActive = libraryView === "titles";
  const priorPointerKey = useRef<string | null>(null);
  useEffect(() => {
    if (suspended || !titlesActive) priorPointerKey.current = null;
  }, [suspended, titlesActive]);

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

  const networkAvailable = useConnectivityOnline(container.connectivity);
  const shelf = entries
    ? createOfflineLibraryEngine().buildShelf(entries, { networkAvailable })
    : null;
  const protectedIds = useMemo(
    () => new Set(container.config.protectedDownloadJobIds),
    [container.config.protectedDownloadJobIds],
  );

  const flatRows = useMemo(() => {
    if (!shelf) return [];
    const rows = buildLibraryFlatRows({ groups: shelf.groups, historyByTitle: historyMap });
    const normalized = filterQuery.trim().toLowerCase();
    if (!normalized) return rows;
    return rows.filter((row) => row.group.titleName.toLowerCase().includes(normalized));
  }, [shelf, historyMap, filterQuery]);
  const sections = useMemo(
    () =>
      shelf ? buildLibraryShelfSections({ groups: shelf.groups, historyByTitle: historyMap }) : [],
    [shelf, historyMap],
  );

  const totalRows = flatRows.length;
  useEffect(() => {
    onRowCountChange(totalRows);
  }, [onRowCountChange, totalRows]);
  const safeIndex = totalRows > 0 ? Math.min(selectedIndex, totalRows - 1) : 0;
  const maxVisible = getPickerListMaxVisible(
    viewport.rows,
    getPickerChromeRows({ hasSubtitle: false, commandMode: suspended, extraRows: 4 }),
  );
  const windowStart = getWindowStart(safeIndex, totalRows, maxVisible);
  const windowEnd = Math.min(windowStart + maxVisible, totalRows);
  const items = buildVisibleLibraryItems(sections, flatRows, safeIndex, windowStart, windowEnd);
  const showScrollUp = windowStart > 0;
  const showScrollDown = windowEnd < totalRows;
  const selectedRow = totalRows > 0 ? flatRows[safeIndex] : null;
  const selectedOfflineGroup = selectedRow?.group ?? null;

  useEffect(() => {
    confirm.transition({
      type: "reconcile",
      visibleIds: flatRows.map((row) => row.group.key),
    });
  }, [confirm, flatRows]);

  const detailEntries = useMemo(() => {
    if (!detailGroup || !entries) return [];
    return selectOfflineGroupEntries(detailGroup, entries);
  }, [detailGroup, entries]);

  const refreshEntries = () =>
    refreshLibraryEntries({
      container,
      detailGroup,
      setEntries,
      setLibraryView,
      setDetailGroup,
      countEntries: (group, nextEntries) => selectOfflineGroupEntries(group, nextEntries).length,
    });

  const openTitle = (group: OfflineLibraryShelfGroup) => {
    confirm.transition({ type: "cancel" });
    setDetailGroup(group);
    setLibraryView("title-detail");
  };
  const scrollTitles = (direction: "up" | "down") => {
    priorPointerKey.current = null;
    confirm.transition({ type: "cancel" });
    setSelectedIndex((current) =>
      Math.max(0, Math.min(totalRows - 1, current + (direction === "up" ? -1 : 1))),
    );
  };

  useInput(
    (input, key) => {
      const confirmState = confirm.getState();
      priorPointerKey.current = null;
      // Esc is resolved in one place: an armed destructive action outranks a
      // non-empty filter, and an empty filter focus is not a layer at all.
      if (key.escape) {
        const layers: EscLayer[] = [
          ...(confirmState.kind !== "idle" ? [{ kind: "confirm" } as const] : []),
          { kind: "filter", query: filterQuery },
          { kind: "overlay" },
        ];
        const action = resolveEscStack(layers);
        if (action === "cancel-confirmation") confirm.transition({ type: "cancel" });
        if (action === "clear-filter") {
          setFilterFocused(false);
          setFilterQuery("");
        }
        if (action === "close-overlay") onClose();
        return;
      }
      if (confirmState.kind === "executing") return;
      if (confirmState.kind !== "idle") {
        if (confirmState.kind === "armed" && input.toLowerCase() === "y") {
          const confirmation = confirm.transition({ type: "confirm" });
          const effect = confirmation.effect;
          if (!effect) return;
          executeLibraryDeletion({
            container,
            effect,
            groups: flatRows,
            confirm,
            setEntries,
          });
          return;
        }
        if (key.upArrow || key.downArrow) confirm.transition({ type: "cancel" });
        return;
      }
      const filterRoute = routeListFilterKey(input, key, {
        focused: filterFocused,
        query: filterQuery,
        actionKeys: LIBRARY_ACTION_KEYS,
      });
      if (key.tab || (input === "2" && filterRoute === "action")) {
        onNavigateToQueue();
        return;
      }
      if (loading || !entries) return;
      if (key.backspace || input === "\b") {
        setFilterQuery((query) => query.slice(0, -1));
        return;
      }
      if (filterRoute === "focus") return setFilterFocused(true);
      // `z` pops the live undo entry; with nothing undoable it starts a filter.
      if (input === "z" && filterRoute === "action" && container.sessionUndo?.hasLiveUndo()) {
        container.sessionUndo.undoLatest();
        return;
      }
      if (filterRoute === "append" || (input === "z" && filterRoute === "action")) {
        setFilterFocused(true);
        setFilterQuery((query) => query + input);
        return;
      }
      if (totalRows === 0) return;
      if (key.upArrow) {
        confirm.transition({ type: "cancel" });
        setSelectedIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        confirm.transition({ type: "cancel" });
        setSelectedIndex((prev) => Math.min(totalRows - 1, prev + 1));
        return;
      }
      if (input === "x" || key.delete) {
        if (!selectedOfflineGroup) return;
        armLibraryDeletion({
          group: selectedOfflineGroup,
          visibleIds: flatRows.map((row) => row.group.key),
          confirm,
        });
        return;
      }
      if (input === "p" || input === "P") {
        if (!selectedOfflineGroup) return;
        toggleLibraryCleanupProtection({ container, group: selectedOfflineGroup });
        return;
      }
      if (key.return) {
        if (!selectedOfflineGroup) return;
        openTitle(selectedOfflineGroup);
        return;
      }
    },
    { isActive: titlesActive && !suspended },
  );

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

  if (!entries || entries.length === 0) {
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
            Switch to Downloads (Tab) to see active downloads
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
        onNavigateToQueue={onNavigateToQueue}
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
      {filterFocused || filterQuery.length > 0 ? (
        <Box marginBottom={1}>
          <Text color={palette.accent}>Filter: </Text>
          <Text color={palette.text} bold>
            {`${filterQuery}▏`}
          </Text>
        </Box>
      ) : null}
      {showScrollUp ? (
        <Text color={palette.dim}>{plainModeEnabled() ? "more above" : " ▲ ..."}</Text>
      ) : null}
      {items.map((item) => {
        if (item.kind === "section") {
          return <SectionGroup key={`section-${item.label}`} label={item.label} marginTop={1} />;
        }
        const { row, selected } = item;
        const title = formatLibraryTitle(
          row.group,
          isLibraryGroupProtected(row.group, protectedIds),
        );
        const ep = formatLibrarySeasonCode(row.group);
        const status = formatLibraryStatus(row, historyMap);
        return (
          <MouseTarget
            key={row.group.key}
            id={`library:row:${row.group.key}`}
            onWheel={scrollTitles}
            onClick={() => {
              confirm.transition({ type: "cancel" });
              if (item.flatIndex !== safeIndex || priorPointerKey.current !== row.group.key) {
                priorPointerKey.current = row.group.key;
                setSelectedIndex(item.flatIndex);
              } else {
                priorPointerKey.current = null;
                openTitle(row.group);
              }
            }}
          >
            <ListRow
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
          </MouseTarget>
        );
      })}
      {showScrollDown ? (
        <Text color={palette.dim}>{plainModeEnabled() ? "more below" : " ▼ ..."}</Text>
      ) : null}
      <ConfirmStrip state={confirm.state} width={rowWidth} />
      {selectedOfflineGroup && !confirmStripOwnsInput(confirm.state) ? (
        <ResumeCard
          {...libraryResumeCardCopy(selectedOfflineGroup)}
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

function buildVisibleLibraryItems(
  sections: readonly LibraryShelfSection[],
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
