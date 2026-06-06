import { Box, Text } from "ink";
import React from "react";

import type { HistoryView } from "./history-view";
import { ClaudeTabRow } from "./primitives/ClaudeTabRow";
import {
  ListRow,
  listRowEpColumn,
  listRowStatusColumn,
  listRowTitleColumn,
} from "./primitives/ListRow";
import { MediaListShell } from "./primitives/MediaListShell";
import { ProgressBar } from "./primitives/ProgressBar";
import { ResumeCard } from "./primitives/ResumeCard";
import { SectionGroup } from "./primitives/SectionGroup";
import { StateBlock } from "./primitives/StateBlock";
import { RETURN_LOOP_HISTORY_NEW_EMPTY, RETURN_LOOP_HISTORY_SUBTITLE } from "./return-loop-copy";
import { palette } from "./shell-theme";
import { usePosterPreview } from "./use-poster-preview";

export function HistoryShell({
  view,
  columns,
  listWidth,
  rowWidth,
}: {
  readonly view: HistoryView;
  readonly columns: number;
  readonly listWidth: number;
  readonly rowWidth: number;
}) {
  const epWidth = 8;
  const statusWidth = Math.min(16, Math.max(10, Math.floor(rowWidth * 0.18)));
  const recencyWidth = 8;
  const titleWidth = Math.max(12, rowWidth - epWidth - statusWidth - recencyWidth - 4);
  // Resolve the selected row's stored poster for the preview rail (same mechanism
  // as browse). Wide-only; the URL now comes from history (persisted on watch).
  const railPosterUrl = view.rail?.posterUrl;
  const { poster: railPoster } = usePosterPreview(railPosterUrl, {
    rows: 12,
    cols: 26,
    enabled: Boolean(railPosterUrl) && columns >= 124,
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
        <>
          <ClaudeTabRow
            labels={view.tabLabels}
            activeIndex={view.tabIndex}
            hint="⇥ Tab cycles filter"
          />
          <ClaudeTabRow
            labels={view.typeFilterLabels}
            activeIndex={view.typeFilterIndex}
            hint="⇧⇥ type"
          />
        </>
      )}

      {view.state === "loading" ? (
        <StateBlock
          model={{
            kind: "loading",
            title: "Loading watch history",
            detail: "Reading local playback positions.",
          }}
          width={rowWidth}
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
          width={rowWidth}
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
            return (
              <Box key={`${row.titleId}-${item.flatIndex}`} flexDirection="column">
                <ListRow
                  selected={selected}
                  rowWidth={rowWidth}
                  columns={[
                    listRowTitleColumn(row.title, titleWidth),
                    listRowEpColumn(row.episodeCode, epWidth),
                    listRowStatusColumn(
                      row.statusLabel,
                      statusWidth,
                      row.statusColor,
                      row.statusDim,
                    ),
                    listRowStatusColumn(row.recencyLabel, recencyWidth, palette.muted, true),
                  ]}
                />
                {row.progress && !row.progress.completed ? (
                  <Box marginLeft={2}>
                    <ProgressBar value={row.progress.percentage} max={100} width={18} />
                  </Box>
                ) : null}
              </Box>
            );
          })}
          {view.showScrollDown ? <Text color={palette.dim}> ▼ ...</Text> : null}
        </Box>
      ) : null}

      {selectedRow ? (
        <ResumeCard label={selectedRow.resumeAction} action="↵ enter" width={rowWidth} />
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
        listWidth={listWidth}
        list={list}
        railModel={view.rail}
        railWidth={32}
        poster={railPoster}
      />
    </Box>
  );
}
