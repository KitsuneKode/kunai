import { Box, Text } from "ink";
import React from "react";

import { plainModeEnabled } from "../../plain-mode";
import { palette } from "../../shell-theme";

export const SettingsSearchBar = React.memo(function SettingsSearchBar({
  query,
  focused,
}: {
  readonly query: string;
  readonly focused: boolean;
}) {
  if (!query && !focused) return null;
  const plain = plainModeEnabled();
  return (
    <Box marginTop={1} marginBottom={1}>
      <Text color={palette.accent}>{plain && focused ? "Search (focused): " : "Search: "}</Text>
      <Text color={palette.text} bold>
        {query}
      </Text>
      {focused && !plain ? <Text color={palette.dim}>▌</Text> : null}
    </Box>
  );
});
