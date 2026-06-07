import { Box, Text } from "ink";
import React from "react";

import { padColumnsEnd, truncateLine } from "../shell-text";
import { palette } from "../shell-theme";
import type { ListRowColumn } from "./ListRow.model";

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
  const markerWidth = 2;
  const colBudget = Math.max(
    8,
    rowWidth - markerWidth - columns.reduce((sum, col) => sum + col.width + 1, 0),
  );
  const flexIndex = flexColumnIndex >= 0 && flexColumnIndex < columns.length ? flexColumnIndex : 0;

  return (
    <Box
      width={rowWidth}
      backgroundColor={selected ? palette.surfaceActive : undefined}
      flexDirection="row"
    >
      <Text color={selected ? palette.accent : palette.dim}>{selected ? `${marker} ` : "  "}</Text>
      {columns.map((col, index) => {
        const width = index === flexIndex ? col.width + colBudget : col.width;
        const text = truncateLine(col.text, width);
        const padded =
          col.align === "right" ? padColumnsEnd(text, width) : truncateLine(text, width);
        return (
          <Box key={`${col.align ?? "left"}:${col.width}:${col.text}`} width={width + 1}>
            <Text
              color={col.color ?? (selected ? palette.text : palette.textDim)}
              bold={selected && index === flexIndex}
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
