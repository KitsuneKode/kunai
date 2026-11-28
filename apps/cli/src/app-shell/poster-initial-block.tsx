import { Box, Text } from "ink";
import React from "react";

import { sanitizeTerminalText } from "./shell-text";
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
  const initial = sanitizeTerminalText(title).trim().charAt(0).toUpperCase() || "?";

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="round"
      borderColor={palette.lineSoft}
      justifyContent="center"
      alignItems="center"
    >
      <Text color={palette.dim} bold>
        {initial}
      </Text>
    </Box>
  );
}
