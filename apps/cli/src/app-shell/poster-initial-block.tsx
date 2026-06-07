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
  const topPadding = "\n".repeat(pad);
  const bottomPadding = "\n".repeat(Math.max(0, height - pad - 2));

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Text color={color} dimColor>
        {topPadding}
      </Text>
      <Text color={color} bold>
        {" ".repeat(Math.max(0, Math.floor((width - 1) / 2)))}
        {initial}
      </Text>
      <Text color={color} dimColor>
        {bottomPadding}
      </Text>
    </Box>
  );
}
