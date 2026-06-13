import { Box, Text } from "ink";
import React from "react";

import { buildMediaListRowColumns, computeMediaListRowLayout } from "./primitives/list-row-layout";
import { ListRow } from "./primitives/ListRow";
import { MediaListShell } from "./primitives/MediaListShell";
import { SectionGroup } from "./primitives/SectionGroup";
import { StateBlock } from "./primitives/StateBlock";
import type { QueueView, QueueViewRow } from "./queue-view";
import { palette } from "./shell-theme";
import { usePosterPreview } from "./use-poster-preview";

function initialsOf(title: string): string {
  return (
    title
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .slice(0, 2)
      .join("") || "?"
  );
}

/**
 * Text-mode mini-poster: `inkEmbedded` produces chafa symbols inside Ink (not a
 * Kitty placement), so many can coexist with the single Kitty hero in the rail;
 * `preserveTerminalImages` keeps a row render from wiping that hero.
 */
function MiniPoster({ url, title }: { readonly url?: string; readonly title: string }) {
  const { poster } = usePosterPreview(url, {
    rows: 2,
    cols: 4,
    enabled: Boolean(url),
    variant: "preview",
    inkEmbedded: true,
    preserveTerminalImages: true,
    debounceMs: 160,
  });
  if (poster.kind !== "none") return <Text>{poster.placeholder}</Text>;
  return <Text color={palette.dim}>{initialsOf(title)}</Text>;
}

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
    row.state === "playing" ? "▶ playing" : row.state === "played" ? "played" : row.sourceLabel;
  const stateColor = row.state === "playing" ? palette.ok : palette.muted;
  return (
    <Box flexDirection="row">
      <Box width={5}>
        <MiniPoster url={row.posterUrl} title={row.title} />
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
            statusDim: row.state !== "playing",
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
}: {
  readonly view: QueueView;
  readonly columns: number;
  readonly listWidth: number;
  readonly rowWidth: number;
}) {
  // Single Kitty hero for the selected item (same mechanism as history's rail).
  const { poster: railPoster } = usePosterPreview(view.rail?.posterUrl, {
    rows: 12,
    cols: 26,
    enabled: Boolean(view.rail?.posterUrl) && columns >= 124,
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
        view.rows.map((row, index) => (
          <QueueRow
            key={row.id}
            row={row}
            selected={index === view.selectedIndex}
            rowWidth={rowWidth}
          />
        ))
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
