import { Box, Text, useInput } from "ink";
import React, { useEffect, useRef } from "react";

import { useRailPoster } from "./hooks/use-rail-poster";
import { MouseTarget } from "./mouse/MouseRegions";
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
    row.state === "starting"
      ? "starting"
      : row.state === "next"
        ? "up next"
        : row.state === "played"
          ? "played"
          : row.sourceLabel;
  const stateColor = row.state === "starting" ? palette.accent : palette.muted;
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
            statusDim: row.state !== "starting",
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
  onRowClick,
  onWheel,
  maxRows,
}: {
  readonly view: QueueView;
  readonly columns: number;
  readonly listWidth: number;
  readonly rowWidth: number;
  readonly onRowClick?: (id: string, activate: boolean) => void;
  readonly onWheel?: (direction: "up" | "down") => void;
  readonly maxRows?: number;
}) {
  const priorPointerId = useRef<string | null>(null);
  // Keyboard input owns the next decision even if a clamped/wrapped selection
  // stays on the same ID (for example, a one-row queue).
  useInput(
    () => {
      priorPointerId.current = null;
    },
    { isActive: Boolean(onRowClick) },
  );
  const selectedId = view.rows[view.selectedIndex]?.id;
  useEffect(() => {
    if (!onRowClick || priorPointerId.current !== selectedId) priorPointerId.current = null;
  }, [onRowClick, selectedId]);
  const scroll = (direction: "up" | "down") => {
    priorPointerId.current = null;
    onWheel?.(direction);
  };
  const visibleCount = Math.max(1, maxRows ?? view.rows.length);
  const start = getWindowStart(view.selectedIndex, view.rows.length, visibleCount);
  // Single Kitty hero for the selected item (same mechanism as history's rail).
  const { poster: railPoster } = useRailPoster(view.rail?.posterUrl, {
    rows: 12,
    cols: 26,
    enabled: columns >= 124,
    variant: "detail",
  });

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
        <>
          {start > 0 ? <Text color={palette.dim}> ▲ ...</Text> : null}
          {view.rows.slice(start, start + visibleCount).map((row, index) => (
            <MouseTarget
              key={row.id}
              id={`queue:row:${row.id}`}
              active={Boolean(onRowClick)}
              onClick={() => {
                const activate = priorPointerId.current === row.id && selectedId === row.id;
                priorPointerId.current = activate ? null : row.id;
                onRowClick?.(row.id, activate);
              }}
              onWheel={onWheel ? scroll : undefined}
            >
              <QueueRow
                row={row}
                selected={start + index === view.selectedIndex}
                rowWidth={rowWidth}
              />
            </MouseTarget>
          ))}
          {start + visibleCount < view.rows.length ? <Text color={palette.dim}> ▼ ...</Text> : null}
        </>
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
