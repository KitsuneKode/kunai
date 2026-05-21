import { Box, Text } from "ink";
import React from "react";

import { heatBucket } from "../format/heatmap";
import { heatColor, palette } from "../shell-theme";

export type HeatRow = { readonly label: string; readonly values: readonly number[] };

/** Watch-activity heatmap in the amber ramp; values bucketed 0..4. */
export const Heatmap = React.memo(function Heatmap({
  rows,
  max,
  cell = "▪",
}: {
  rows: readonly HeatRow[];
  max: number;
  cell?: string;
}) {
  return (
    <Box flexDirection="column">
      {rows.map((row) => (
        <Box key={row.label}>
          <Text color={palette.muted}>{row.label.padEnd(4)}</Text>
          {row.values.map((value, i) => (
            <Text key={i} color={heatColor(heatBucket(value, max))}>
              {` ${cell}`}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  );
});
