import { Box, Text } from "ink";
import React from "react";

import { useRailPoster } from "./hooks/use-rail-poster";
import { buildMediaListRowColumns, computeMediaListRowLayout } from "./primitives/list-row-layout";
import { ListRow } from "./primitives/ListRow";
import { MediaListShell } from "./primitives/MediaListShell";
import { MiniPosterTile } from "./primitives/MiniPosterTile";
import { SectionGroup } from "./primitives/SectionGroup";
import { StateBlock } from "./primitives/StateBlock";
import type { QueueView, QueueViewRow } from "./queue-view";
import { getWindowStart } from "./shell-text";
import { palette } from "./shell-theme";

function QueueRow({
  row,
  selected,
  rowWidth,
}: {
  readonly row: QueueViewRow;
  readonly selected: boolean;
  readonly rowWidth: number;
}) {
  const innerWidth = Math.max(16, rowWidth - 5);
  const layout = computeMediaListRowLayout(innerWidth, { hasEpisode: true });
  const stateLabel =
    row.state === "next" ? "▶ next up" : row.state === "played" ? "played" : row.sourceLabel;
  const stateColor = row.state === "next" ? palette.ok : palette.muted;
  return (
    <Box flexDirection="row">
      <Box width={5}>
        <MiniPosterTile url={row.posterUrl} title={row.title} enabled={selected} />
      </Box>
      <Box flexGrow={1}>
        <ListRow
          selected={selected}
          rowWidth={innerWidth}
          flexColumnIndex={layout.flexColumnIndex}
          columns={buildMediaListRowColumns({
            title: row.title,
            episodeCode: row.episodeLabel,
            statusLabel: stateLabel,
            statusColor: stateColor,
            statusDim: row.state !== "next",
            layout,
          })}
        />
      </Box>
    </Box>
  );
}

export function QueueShell({
  view,
  columns,
  listWidth,
  rowWidth,
  maxVisible,
}: {
  readonly view: QueueView;
  readonly columns: number;
  readonly listWidth: number;
  readonly rowWidth: number;
  /** Row budget from the overlay layout; windows long queues around selection. */
  readonly maxVisible: number;
}) {
  // Single Kitty hero for the selected item (same mechanism as history's rail).
  const { poster: railPoster } = useRailPoster(view.rail?.posterUrl, {
    rows: 12,
    cols: 26,
    enabled: columns >= 124,
    variant: "detail",
  });

  // Window around the selection — unbounded mapping let J/K move the highlight
  // onto rows clipped below the fold (invisible-cursor x/reorder operations).
  const windowStart = getWindowStart(view.selectedIndex, view.rows.length, maxVisible);
  const windowEnd = Math.min(windowStart + maxVisible, view.rows.length);
  const visibleRows = view.rows.slice(windowStart, windowEnd);

  const list = (
    <Box flexDirection="column" flexGrow={1}>
      <SectionGroup
        label="Up Next"
        tag={`${view.counts.unplayed} queued${view.stale ? " · stale" : ""}`}
        marginTop={0}
      />
      {view.state === "empty" ? (
        <StateBlock
          model={{ kind: "empty", title: "Nothing queued", detail: view.emptyHint }}
          width={rowWidth}
        />
      ) : (
        <Box flexDirection="column">
          {windowStart > 0 ? (
            <Text color={palette.dim} dimColor>
              {"  "}more above
            </Text>
          ) : null}
          {visibleRows.map((row, index) => (
            <QueueRow
              key={row.id}
              row={row}
              selected={windowStart + index === view.selectedIndex}
              rowWidth={rowWidth}
            />
          ))}
          {windowEnd < view.rows.length ? (
            <Text color={palette.dim} dimColor>
              {"  "}more below
            </Text>
          ) : null}
        </Box>
      )}
    </Box>
  );

  return (
    <Box flexDirection="column" flexGrow={1} marginTop={1} paddingX={1}>
      <MediaListShell
        columns={columns}
        listWidth={listWidth}
        list={list}
        railWidth={32}
        poster={railPoster}
        railModel={
          view.rail
            ? {
                title: view.rail.title,
                subtitle: view.rail.episodeLabel,
                posterUrl: view.rail.posterUrl,
                posterState: "none",
                facts: [{ label: "Source", value: view.rail.sourceLabel, tone: "muted" }],
              }
            : null
        }
      />
    </Box>
  );
}
