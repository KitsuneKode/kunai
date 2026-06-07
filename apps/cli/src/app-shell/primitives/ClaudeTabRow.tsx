import { Box, Text } from "ink";
import React from "react";

import { segmentGeometry } from "../format/segmented";
import { palette } from "../shell-theme";

/** Claude Code–style tier-1 tabs: active = rose accentFill pill + bold text. */
export const ClaudeTabRow = React.memo(function ClaudeTabRow({
  labels,
  activeIndex,
  hint,
}: {
  readonly labels: readonly string[];
  readonly activeIndex: number;
  readonly hint?: string;
}) {
  const segments = segmentGeometry(labels, activeIndex);
  return (
    <Box flexDirection="row" marginTop={1} marginBottom={1} alignItems="center">
      {segments.map((seg, i) => (
        <React.Fragment key={seg.label}>
          {i > 0 ? <Text color={palette.dim}>{"  "}</Text> : null}
          <Text
            bold={seg.active}
            color={seg.active ? palette.text : palette.textDim}
            backgroundColor={seg.active ? palette.accentFill : undefined}
          >
            {seg.text}
          </Text>
        </React.Fragment>
      ))}
      {hint ? (
        <Box marginLeft={2}>
          <Text color={palette.dim} dimColor>
            {hint}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
});
