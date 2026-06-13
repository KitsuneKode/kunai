import { Box, Text } from "ink";
import React from "react";

import { palette } from "../shell-theme";
import { heatmapCellColor, type HeatRow } from "./Heatmap.model";

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
      {rows.map((row) => {
        const seenValues = new Map<number, number>();
        return (
          <Box key={row.label}>
            <Text color={palette.muted}>{row.label.padEnd(4)}</Text>
            {row.values.map((value) => {
              const seenCount = seenValues.get(value) ?? 0;
              seenValues.set(value, seenCount + 1);
              return (
                <Text
                  key={`${row.label}:${value}:${seenCount}`}
                  color={heatmapCellColor(value, max, tintHex)}
                >
                  {` ${cell}`}
                </Text>
              );
            })}
          </Box>
        );
      })}
    </Box>
  );
});
