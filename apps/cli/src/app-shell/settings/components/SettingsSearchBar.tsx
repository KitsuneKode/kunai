import { Box, Text } from "ink";
import React from "react";

import { palette } from "../../shell-theme";

export const SettingsSearchBar = React.memo(function SettingsSearchBar({
  query,
}: {
  readonly query: string;
}) {
  if (!query) return null;
  return (
    <Box marginTop={1} marginBottom={1}>
      <Text color={palette.accent}>Search: </Text>
      <Text color={palette.text} bold>
        {query}
      </Text>
      <Text color={palette.dim}>▌</Text>
    </Box>
  );
});
