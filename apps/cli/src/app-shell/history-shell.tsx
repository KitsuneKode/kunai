import { Box, Text } from "ink";
import React from "react";

import { compactProgressBar } from "./format/bar";
import type { HistoryView } from "./history-view";
import { useRailPoster } from "./hooks/use-rail-poster";
import { ClaudeTabRow } from "./primitives/ClaudeTabRow";
import { buildMediaListRowColumns, computeMediaListRowLayout } from "./primitives/list-row-layout";
import { ListRow } from "./primitives/ListRow";
import { MediaListShell } from "./primitives/MediaListShell";
import { ResumeCard } from "./primitives/ResumeCard";
import { SectionGroup } from "./primitives/SectionGroup";
import { StateBlock } from "./primitives/StateBlock";
import { RETURN_LOOP_HISTORY_NEW_EMPTY, RETURN_LOOP_HISTORY_SUBTITLE } from "./return-loop-copy";
import { palette } from "./shell-theme";

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
  const rowLayout = computeMediaListRowLayout(rowWidth, { hasEpisode: true, hasRecency: true });
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
            hint={listWidth >= 100 ? "⇥ Tab cycles filter" : undefined}
            maxWidth={listWidth}
            dense
          />
          <ClaudeTabRow
            labels={view.typeFilterLabels}
            activeIndex={view.typeFilterIndex}
            hint={listWidth >= 100 ? "⇧⇥ type" : undefined}
            maxWidth={listWidth}
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
          width={rowWidth}
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
                rowWidth={rowWidth}
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
