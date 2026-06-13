import { Box, Text } from "ink";
import React from "react";

import { segmentGeometry } from "../format/segmented";
import { truncateLine } from "../shell-text";
import { palette } from "../shell-theme";

/** Claude Code–style tier-1 tabs: active = rose accentFill pill + bold text. */
export const ClaudeTabRow = React.memo(function ClaudeTabRow({
  labels,
  activeIndex,
  hint,
  maxWidth,
  dense = false,
}: {
  readonly labels: readonly string[];
  readonly activeIndex: number;
  readonly hint?: string;
  readonly maxWidth?: number;
  readonly dense?: boolean;
}) {
  const segments = segmentGeometry(labels, activeIndex);
  return (
    <Box
      flexDirection="row"
      marginTop={dense ? 0 : 1}
      marginBottom={dense ? 0 : 1}
      alignItems="center"
      width={maxWidth}
      overflow="hidden"
    >
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
        <Box marginLeft={1} flexShrink={0}>
          <Text color={palette.dim} dimColor wrap="truncate">
            {truncateLine(hint, Math.max(12, (maxWidth ?? 120) - 48))}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
});
