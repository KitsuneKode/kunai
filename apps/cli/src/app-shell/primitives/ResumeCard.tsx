import { Box, Text } from "ink";
import React from "react";

import { truncateLine } from "../shell-text";
import { palette } from "../shell-theme";

export const ResumeCard = React.memo(function ResumeCard({
  label,
  action,
  width = 28,
}: {
  readonly label: string;
  readonly action?: string;
  readonly width?: number;
}) {
  return (
    <Box
      marginTop={1}
      paddingX={1}
      paddingY={0}
      backgroundColor={palette.surfaceActive}
      flexDirection="row"
      justifyContent="space-between"
      width={width}
    >
      <Text color={palette.text} bold>
        {truncateLine(label, width - (action ? measureAction(action) + 2 : 4))}
      </Text>
      {action ? <Text color={palette.accent}>{action}</Text> : null}
    </Box>
  );
});

function measureAction(action: string): number {
  return action.length;
}
