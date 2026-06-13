import { Box, Text } from "ink";
import React from "react";

import { padColumnsEnd, padColumnsStart, truncateLine } from "../shell-text";
import { palette } from "../shell-theme";
import type { ListRowColumn } from "./ListRow.model";

const MARKER_WIDTH = 2;
const COLUMN_GAP = 1;

function listRowColumnWidths(
  columns: readonly ListRowColumn[],
  rowWidth: number,
  flexColumnIndex: number,
): readonly number[] {
  const flexIndex = flexColumnIndex >= 0 && flexColumnIndex < columns.length ? flexColumnIndex : 0;
  const fixedWidth = columns.reduce(
    (sum, col, index) => (index === flexIndex ? sum : sum + col.width + COLUMN_GAP),
    0,
  );
  const flexBase = columns[flexIndex]?.width ?? 0;
  const flexWidth = Math.max(1, rowWidth - MARKER_WIDTH - fixedWidth - COLUMN_GAP - flexBase);
  return columns.map((col, index) => (index === flexIndex ? flexBase + flexWidth : col.width));
}

export const ListRow = React.memo(function ListRow({
  selected,
  marker = "▌",
  columns,
  rowWidth,
  flexColumnIndex = 0,
}: {
  readonly selected: boolean;
  readonly marker?: string;
  readonly columns: readonly ListRowColumn[];
  readonly rowWidth: number;
  /** Which column absorbs the leftover row width. Defaults to the first column
   *  (the usual "title leads" layout); set to the title's index when a fixed
   *  column precedes it (e.g. the calendar's time column) so the others stay
   *  aligned and the title — not a fixed column — gets the slack. */
  readonly flexColumnIndex?: number;
}) {
  const columnWidths = listRowColumnWidths(columns, rowWidth, flexColumnIndex);

  return (
    <Box
      width={rowWidth}
      backgroundColor={selected ? palette.surfaceActive : undefined}
      flexDirection="row"
      overflow="hidden"
    >
      <Text color={selected ? palette.accent : palette.dim}>{selected ? `${marker} ` : "  "}</Text>
      {columns.map((col, index) => {
        const width = columnWidths[index] ?? col.width;
        const clipped = truncateLine(col.text, width);
        const padded =
          col.align === "right" ? padColumnsStart(clipped, width) : padColumnsEnd(clipped, width);
        return (
          <Box
            key={`${col.align ?? "left"}:${col.width}:${col.text}`}
            width={width + COLUMN_GAP}
            overflow="hidden"
          >
            <Text
              wrap="truncate"
              color={col.color ?? (selected ? palette.text : palette.textDim)}
              bold={selected && index === flexColumnIndex}
              dimColor={col.dim ?? !selected}
            >
              {padded}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
});
