import { Box, Text } from "ink";
import React from "react";

import { compactProgressBar } from "./format/bar";
import type { HistoryView } from "./history-view";
import { useRailPoster } from "./hooks/use-rail-poster";
import { ClaudeTabRow } from "./primitives/ClaudeTabRow";
import { buildMediaListRowColumns, computeMediaListRowLayout } from "./primitives/list-row-layout";
import { ListRow } from "./primitives/ListRow";
import { MediaListShell } from "./primitives/MediaListShell";
import { shouldRenderPreviewRail } from "./primitives/PreviewRail.model";
import { ResumeCard } from "./primitives/ResumeCard";
import { SectionGroup } from "./primitives/SectionGroup";
import { StateBlock } from "./primitives/StateBlock";
import { RETURN_LOOP_HISTORY_NEW_EMPTY, RETURN_LOOP_HISTORY_SUBTITLE } from "./return-loop-copy";
import { palette } from "./shell-theme";
import type { HistoryDeletePending } from "./use-history-overlay-input";

export function HistoryShell({
  view,
  columns,
  listWidth,
  rowWidth,
  pendingDelete = null,
}: {
  readonly view: HistoryView;
  readonly columns: number;
  readonly listWidth: number;
  readonly rowWidth: number;
  readonly pendingDelete?: HistoryDeletePending | null;
}) {
  const railWidth = 32;
  const railGap = 2;
  const showRail = shouldRenderPreviewRail({ columns, hasModel: view.rail !== null });
  const effectiveListWidth = showRail
    ? Math.min(listWidth, Math.max(36, columns - railWidth - railGap - 4))
    : listWidth;
  const effectiveRowWidth = Math.min(rowWidth, Math.max(20, effectiveListWidth - 4));
  const rowLayout = computeMediaListRowLayout(effectiveRowWidth, {
    hasEpisode: true,
    hasRecency: true,
  });
  // Resolve the selected row's stored poster for the preview rail (same mechanism
  // as browse). Wide-only; the URL now comes from history (persisted on watch).
  const railPosterUrl = view.rail?.posterUrl;
  const { poster: railPoster } = useRailPoster(railPosterUrl, {
    rows: 12,
    cols: 26,
    enabled: columns >= 124,
  });
  const selectedItem = view.items.find(
    (item): item is Extract<HistoryView["items"][number], { kind: "row" }> =>
      item.kind === "row" && item.selected,
  );
  const selectedRow =
    selectedItem !== undefined ? view.flatRows[selectedItem.flatIndex] : view.flatRows[0];

  const list = (
    <Box flexDirection="column" flexGrow={1}>
      {view.filterQuery.length > 0 ? (
        <Box marginTop={1} marginBottom={1}>
          <Text color={palette.accent}>Filter: </Text>
          <Text color={palette.text} bold>
            {view.filterQuery}
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1} marginBottom={1}>
          <ClaudeTabRow
            labels={view.tabLabels}
            activeIndex={view.tabIndex}
            hint={effectiveListWidth >= 100 ? "⇥ Tab · ⇧⇥ cycles tabs" : undefined}
            maxWidth={effectiveListWidth}
            dense
          />
          <ClaudeTabRow
            labels={view.typeFilterLabels}
            activeIndex={view.typeFilterIndex}
            hint={effectiveListWidth >= 100 ? "←→ type" : undefined}
            maxWidth={effectiveListWidth}
            dense
          />
        </Box>
      )}

      {view.state === "loading" ? (
        <StateBlock
          model={{
            kind: "loading",
            title: "Loading watch history",
            detail: "Reading local playback positions.",
          }}
          width={effectiveRowWidth}
        />
      ) : null}

      {view.state === "error" ? (
        <StateBlock
          model={{
            kind: "error",
            title: "Couldn't load watch history",
            detail: view.errorMessage ?? "The local history store could not be read.",
            actions: [{ id: "retry", label: "Reopen history to retry", shortcut: "Esc" }],
          }}
          width={effectiveRowWidth}
        />
      ) : null}

      {view.state === "empty" ? (
        <StateBlock
          model={{
            kind: "empty",
            title: "No history in this view",
            detail:
              view.tab === "continue"
                ? "Nothing to resume yet. Watch something and it will appear here."
                : view.tab === "new-episodes"
                  ? RETURN_LOOP_HISTORY_NEW_EMPTY
                  : view.tab === "completed"
                    ? "Nothing marked complete yet."
                    : "Playback positions appear here after mpv reports progress.",
          }}
          width={effectiveRowWidth}
        />
      ) : null}

      {view.state === "success" ? (
        <Box flexDirection="column" flexGrow={1}>
          {view.showScrollUp ? <Text color={palette.dim}> ▲ ...</Text> : null}
          {view.items.map((item) => {
            if (item.kind === "section") {
              return <SectionGroup key={`section-${item.label}`} label={item.label} />;
            }
            const { row, selected } = item;
            // In-progress rows show a compact inline meter + percent in the status
            // cell — keeps every row one line tall (no detached full-width bar that
            // broke the list rhythm) while still reading as "continue watching".
            // A row that carries a badge (e.g. "new") keeps the badge as its status;
            // the meter only replaces a bare percentage.
            const progress =
              !row.badge && row.progress && !row.progress.completed ? row.progress : null;
            const statusLabel = progress
              ? `${compactProgressBar(progress.percentage)} ${Math.round(progress.percentage)}%`
              : row.statusLabel;
            return (
              <ListRow
                key={`${row.titleId}-${item.flatIndex}`}
                selected={selected}
                rowWidth={effectiveRowWidth}
                flexColumnIndex={rowLayout.flexColumnIndex}
                columns={buildMediaListRowColumns({
                  title: row.title,
                  episodeCode: row.episodeCode,
                  statusLabel,
                  statusColor: row.statusColor,
                  statusDim: row.statusDim,
                  recencyLabel: row.recencyLabel,
                  layout: rowLayout,
                })}
              />
            );
          })}
          {view.showScrollDown ? <Text color={palette.dim}> ▼ ...</Text> : null}
        </Box>
      ) : null}

      {selectedRow ? (
        <Box flexDirection="column">
          {pendingDelete ? (
            <Box marginTop={1}>
              <Text color={palette.accentDeep}>
                {"⚠ "}
                {pendingDelete.kind === "episode"
                  ? `Delete episode progress for ${pendingDelete.label}? y confirm · Esc cancel`
                  : `Delete all history for ${pendingDelete.label}? y confirm · Esc cancel`}
              </Text>
            </Box>
          ) : (
            <>
              <ResumeCard
                label={selectedRow.resumeAction}
                action="↵ enter"
                width={effectiveRowWidth}
              />
              {selectedRow.dualSourceAvailable ? (
                <Text color={palette.dim}>[l] local · [s] stream</Text>
              ) : null}
            </>
          )}
        </Box>
      ) : null}
    </Box>
  );

  return (
    <Box flexDirection="column" flexGrow={1} marginTop={1} paddingX={1}>
      <Text color={palette.text} bold>
        History
      </Text>
      <Text color={palette.dim}>{RETURN_LOOP_HISTORY_SUBTITLE}</Text>
      <MediaListShell
        columns={columns}
        listWidth={effectiveListWidth}
        list={list}
        railModel={view.rail}
        railWidth={railWidth}
        poster={railPoster}
      />
    </Box>
  );
}
