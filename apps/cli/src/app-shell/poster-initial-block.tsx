import { Box, Text } from "ink";
import React from "react";

import { palette } from "./shell-theme";

export function PosterInitialBlock({
  title,
  width = 10,
  height = 6,
}: {
  title: string;
  width?: number;
  height?: number;
}) {
  const color = palette.muted;
  const initial = title.trim().charAt(0).toUpperCase() || "?";
  const pad = Math.max(0, Math.floor((height - 1) / 2));

  const rows: React.ReactNode[] = [];

  // Top padding rows
  for (let i = 0; i < pad; i++) {
    rows.push(
      <Text key={`${title}:pad-top:${i}`} color={color} dimColor>
        {" ".repeat(width)}
      </Text>,
    );
  }

  // Center row with initial
  rows.push(
    <Text key={`${title}:initial`} color={color} bold>
      {" ".repeat(Math.max(0, Math.floor((width - 1) / 2)))}
      {initial}
    </Text>,
  );

  // Bottom padding rows
  for (let i = 0; i < height - pad - 1; i++) {
    rows.push(
      <Text key={`${title}:pad-bottom:${i}`} color={color} dimColor>
        {" ".repeat(width)}
      </Text>,
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      {rows}
    </Box>
  );
}
