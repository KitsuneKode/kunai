import { Box, Text } from "ink";
import React from "react";

import { padColumnsEnd, truncateLine } from "../shell-text";
import { palette } from "../shell-theme";

export type ListRowColumn = {
  readonly text: string;
  readonly width: number;
  readonly color?: string;
  readonly dim?: boolean;
  readonly align?: "left" | "right";
};

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

export function listRowTimeColumn(time: string, width = 6): ListRowColumn {
  return { text: time, width, color: palette.text, align: "left" };
}

export function listRowTitleColumn(title: string, width: number): ListRowColumn {
  return { text: title, width, color: palette.text };
}

export function listRowEpColumn(
  ep: string,
  width = 8,
  color: string = palette.muted,
): ListRowColumn {
  // A per-kind tint (anime/series/movie) reads as a vivid tag; the default muted
  // ep code stays dim.
  return { text: ep, width, color, dim: color === palette.muted };
}

export function listRowStatusColumn(
  status: string,
  width: number,
  color: string,
  dim = false,
): ListRowColumn {
  // Cap at the budgeted width — expanding to the status's own measured width
  // overflowed the row and wrapped a long status ("aired · not available") into
  // the next row (the calendar/history "spill"). ListRow truncates to fit.
  return {
    text: status,
    width,
    color,
    dim,
    align: "right",
  };
}
