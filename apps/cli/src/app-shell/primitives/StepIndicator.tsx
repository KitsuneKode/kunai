import { Box, Text } from "ink";
import React from "react";

import { palette } from "../shell-theme";

/** Setup wizard dotline — filled = current/completed, hollow = upcoming. */
export const StepIndicator = React.memo(function StepIndicator({
  total,
  current,
  label,
}: {
  readonly total: number;
  readonly current: number;
  readonly label?: string;
}) {
  return (
    <Box flexDirection="row" alignItems="center" gap={1}>
      {Array.from({ length: total }, (_, i) => (
        <Text key={i} color={i <= current ? palette.accent : palette.line}>
          {i <= current ? "●" : "○"}
        </Text>
      ))}
      {label ? (
        <Box marginLeft={2}>
          <Text color={palette.muted}>{label}</Text>
        </Box>
      ) : null}
    </Box>
  );
});
