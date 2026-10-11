import { Box, Text } from "ink";
import React from "react";

import { palette } from "../../shell-theme";

export const SettingsSearchBar = React.memo(function SettingsSearchBar({
  query,
  focused,
}: {
  readonly query: string;
  readonly focused: boolean;
}) {
  if (!query && !focused) return null;
  return (
    <Box marginTop={1} marginBottom={1}>
      <Text color={palette.accent}>Search: </Text>
      <Text color={palette.text} bold>
        {query}
      </Text>
      {focused ? <Text color={palette.dim}>▌</Text> : null}
    </Box>
  );
});
