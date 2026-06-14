import { Box, Text } from "ink";
import React from "react";

import type { NotificationRow, NotificationsView } from "./notifications-view";
import { SectionGroup } from "./primitives/SectionGroup";
import { StateBlock } from "./primitives/StateBlock";
import { truncateLine } from "./shell-text";
import { palette } from "./shell-theme";
import { usePosterPreview } from "./use-poster-preview";

// Text-mode mini-poster (chafa inside Ink) for new-episode rows — coexists with
// any single Kitty image and degrades to title initials when no poster URL.
function NotifMini({ url, title }: { readonly url?: string; readonly title: string }) {
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
  return <Text color={palette.dim}>{title.slice(0, 2).toUpperCase()}</Text>;
}

function Row({
  row,
  selected,
  width,
}: {
  readonly row: NotificationRow;
  readonly selected: boolean;
  readonly width: number;
}) {
  const titleWidth = Math.max(8, width - 14);
  return (
    <Box flexDirection="row" flexWrap="nowrap">
      <Text color={selected ? palette.accent : palette.ok}>{selected ? "▌" : " "}</Text>
      <Text color={palette.accent}>{row.unread ? "● " : "  "}</Text>
      {row.usePoster ? (
        <Box width={5}>
          <NotifMini url={row.posterUrl} title={row.title} />
        </Box>
      ) : (
        <Text color={palette.muted}>{row.glyph} </Text>
      )}
      <Box flexDirection="column" flexGrow={1}>
        <Text color={row.unread ? palette.text : palette.textDim} bold={row.unread}>
          {truncateLine(row.title, titleWidth)}
        </Text>
        <Text color={palette.muted}>{truncateLine(row.body, titleWidth)}</Text>
      </Box>
      <Text color={palette.dim}>{row.relativeTime}</Text>
    </Box>
  );
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
  const rowWidth = Math.max(30, Math.min(columns - 4, 110));
  const tabs = `${view.tab === "active" ? "[Active]" : "Active"}  ${view.tab === "archive" ? "[Archive]" : "Archive"}`;
  return (
    <Box flexDirection="column" flexGrow={1} marginTop={1} paddingX={1}>
      <SectionGroup
        label="Notifications"
        tag={unreadCount > 0 ? `${unreadCount} unread · ${tabs}` : tabs}
        marginTop={0}
      />
      {view.isEmpty ? (
        <StateBlock
          model={{ kind: "empty", title: "No notifications", detail: "You're all caught up." }}
          width={rowWidth}
        />
      ) : (
        <Box flexDirection="column">
          {view.rows.map((row, index) => (
            <Row key={row.dedupKey} row={row} selected={index === selectedIndex} width={rowWidth} />
          ))}
        </Box>
      )}
      {view.totalPages > 1 ? (
        <Box marginTop={1}>
          <Text color={palette.dim}>{`page ${view.page + 1}/${view.totalPages} · [ ]`}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
