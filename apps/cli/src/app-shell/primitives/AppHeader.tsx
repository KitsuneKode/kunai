import { Box, Text } from "ink";
import React from "react";

import { composeHeader } from "../format/header";
import { palette } from "../shell-theme";

/**
 * The single canonical header. Owns brand · destination pill · context · status
 * · size — content must not re-render any of these (kills the duplicate top bar).
 */
export const AppHeader = React.memo(function AppHeader({
  brand = "🦊 Kunai",
  destination,
  context,
  status,
  statusColor = palette.ok,
  size,
}: {
  brand?: string;
  destination: string;
  context?: string;
  status?: string;
  statusColor?: string;
  size?: string;
}) {
  const h = composeHeader({ brand, destination, context, status, size });
  return (
    <Box justifyContent="space-between">
      <Box>
        <Text bold color={palette.text}>
          {h.brand}
        </Text>
        <Text color={palette.dim}>{"  ·  "}</Text>
        <Text bold color={palette.bg} backgroundColor={palette.text}>
          {h.pill}
        </Text>
        {h.context ? <Text color={palette.muted}>{`  ${h.context}`}</Text> : null}
      </Box>
      {h.right ? (
        <Box>
          {status ? <Text color={statusColor}>{"● "}</Text> : null}
          <Text color={palette.muted}>{h.right}</Text>
        </Box>
      ) : null}
    </Box>
  );
});
