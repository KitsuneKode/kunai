import { Box, Text } from "ink";
import React from "react";

import { heatBucket } from "../format/heatmap";
import { heatColor, palette, statsHeatCellColor } from "../shell-theme";

export type HeatRow = { readonly label: string; readonly values: readonly number[] };

function cellColor(value: number, max: number, tintHex?: string): string {
  const bucket = heatBucket(value, max);
  if (tintHex) return statsHeatCellColor(bucket, tintHex);
  return heatColor(bucket);
}

/** Watch-activity heatmap; optional tintHex enables Stats paint-mix (type hue × intensity). */
export const Heatmap = React.memo(function Heatmap({
  rows,
  max,
  cell = "▪",
  tintHex,
}: {
  rows: readonly HeatRow[];
  max: number;
  cell?: string;
  tintHex?: string;
}) {
  return (
    <Box flexDirection="column">
      {rows.map((row) => (
        <Box key={row.label}>
          <Text color={palette.muted}>{row.label.padEnd(4)}</Text>
          {row.values.map((value, i) => (
            // Fixed-position grid cell: column index is its stable identity (cells never reorder).
            // oxlint-disable-next-line react/no-array-index-key
            <Text key={`${row.label}-${i}`} color={cellColor(value, max, tintHex)}>
              {` ${cell}`}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  );
});

export { cellColor as heatmapCellColor };
