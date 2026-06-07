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
}: {
  readonly selected: boolean;
  readonly marker?: string;
  readonly columns: readonly ListRowColumn[];
  readonly rowWidth: number;
}) {
  const markerWidth = 2;
  const colBudget = Math.max(
    8,
    rowWidth - markerWidth - columns.reduce((sum, col) => sum + col.width + 1, 0),
  );
  const primary = columns[0];
  const primaryWidth = primary ? primary.width + colBudget : colBudget;

  return (
    <Box
      width={rowWidth}
      backgroundColor={selected ? palette.surfaceActive : undefined}
      flexDirection="row"
    >
      <Text color={selected ? palette.accent : palette.dim}>{selected ? `${marker} ` : "  "}</Text>
      {columns.map((col, index) => {
        const width = index === 0 ? primaryWidth : col.width;
        const text = truncateLine(col.text, width);
        const padded =
          col.align === "right" ? padColumnsEnd(text, width) : truncateLine(text, width);
        return (
          <Box key={`${col.align ?? "left"}:${col.width}:${col.text}`} width={width + 1}>
            <Text
              color={col.color ?? (selected ? palette.text : palette.textDim)}
              bold={selected && index === 0}
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
