import { Box, Text } from "ink";
import React from "react";

import { mapPosterPreviewState } from "./browse-preview-rail";
import { useRailPoster } from "./hooks/use-rail-poster";
import type { NotificationRow, NotificationsView } from "./notifications-view";
import { ListRow } from "./primitives/ListRow";
import {
  listRowStatusColumn,
  listRowTimeColumn,
  listRowTitleColumn,
  type ListRowColumn,
} from "./primitives/ListRow.model";
import { MediaListShell } from "./primitives/MediaListShell";
import { PreviewRail } from "./primitives/PreviewRail";
import { shouldRenderPreviewRail } from "./primitives/PreviewRail.model";
import { SectionGroup } from "./primitives/SectionGroup";
import { StateBlock } from "./primitives/StateBlock";
import { palette } from "./shell-theme";
import type { ShellStatusTone } from "./types";

const RAIL_WIDTH = 32;

function toneColor(tone: ShellStatusTone): string {
  if (tone === "error") return palette.danger;
  if (tone === "warning") return palette.warn;
  if (tone === "success") return palette.ok;
  if (tone === "info") return palette.info;
  return palette.muted;
}

function rowColumns(row: NotificationRow): readonly ListRowColumn[] {
  return [
    {
      text: row.unread ? `● ${row.glyph}` : `  ${row.glyph}`,
      width: 4,
      color: row.unread ? toneColor(row.tone) : palette.dim,
      dim: !row.unread,
    },
    listRowTitleColumn(row.title, 12),
    listRowStatusColumn(
      row.primaryAction.label,
      16,
      row.actionable ? palette.accent : palette.muted,
    ),
    listRowTimeColumn(row.relativeTime, 5),
  ];
}

export function NotificationsShell({
  view,
  columns,
  selectedIndex,
  unreadCount,
}: {
  readonly view: NotificationsView;
  readonly columns: number;
  readonly selectedIndex: number;
  readonly unreadCount: number;
}) {
  const showRail = shouldRenderPreviewRail({ columns, hasModel: view.rail !== null });
  const { poster, posterState } = useRailPoster(view.rail?.preview.posterUrl, {
    rows: 10,
    cols: 28,
    enabled: showRail,
    variant: "detail",
  });

  const innerWidth = Math.max(30, columns - 4);
  const listWidth = showRail
    ? Math.max(40, innerWidth - RAIL_WIDTH - 2)
    : Math.min(innerWidth, 110);

  const context = [
    view.tabLabel,
    view.sortLabel,
    unreadCount > 0 && view.tab === "active" ? `${unreadCount} unread` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const previewPosterState = mapPosterPreviewState({
    hasPosterPath: Boolean(view.rail?.preview.posterUrl),
    poster,
    posterState,
  });

  const rail =
    showRail && view.rail ? (
      <Box flexDirection="column" width={RAIL_WIDTH}>
        <PreviewRail
          model={{ ...view.rail.preview, posterState: previewPosterState }}
          width={RAIL_WIDTH}
          poster={poster}
        />
        <Box marginTop={1} flexDirection="column">
          <Text color={palette.accent} bold>{`↵ ${view.rail.primaryAction.label}`}</Text>
          {view.rail.secondaryActions.slice(0, 3).map((action) => (
            <Text key={action.id} color={palette.muted}>{`· ${action.label}`}</Text>
          ))}
        </Box>
        <Box marginTop={1} flexDirection="column">
          {view.rail.lifecycleHints.map((hint) => (
            <Text key={hint.key} color={palette.dim}>{`${hint.key} ${hint.label}`}</Text>
          ))}
        </Box>
      </Box>
    ) : undefined;

  const list = view.isEmpty ? (
    <StateBlock model={{ kind: "empty", title: view.emptyTitle }} width={listWidth} />
  ) : (
    <Box flexDirection="column">
      {view.rows.map((row, index) => (
        <ListRow
          key={row.dedupKey}
          selected={index === selectedIndex}
          columns={rowColumns(row)}
          rowWidth={listWidth}
          flexColumnIndex={1}
        />
      ))}
    </Box>
  );

  return (
    <Box flexDirection="column" flexGrow={1} marginTop={1} paddingX={1}>
      <SectionGroup label="Notifications" tag={context} marginTop={0} />
      <MediaListShell
        columns={columns}
        listWidth={listWidth}
        railWidth={RAIL_WIDTH}
        list={list}
        rail={rail}
      />
      {view.totalPages > 1 ? (
        <Box marginTop={1}>
          <Text color={palette.dim}>{`page ${view.page + 1}/${view.totalPages}`}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
