import { Box, Text } from "ink";
import React from "react";

import { barFill } from "../format/bar";
import { palette } from "../shell-theme";

export const ProgressBar = React.memo(function ProgressBar({
  value,
  max,
  width = 20,
  color = palette.accentDeep,
}: {
  value: number;
  max: number;
  width?: number;
  color?: string;
}) {
  const { filled, track } = barFill(value, max, width);
  return (
    <Box>
      <Text color={color}>{"█".repeat(filled)}</Text>
      <Text color={palette.dim}>{"┈".repeat(track)}</Text>
    </Box>
  );
});
