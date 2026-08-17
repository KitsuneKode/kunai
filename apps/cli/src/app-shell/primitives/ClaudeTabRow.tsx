import { Box, Text } from "ink";
import React from "react";

import { windowedSegmentGeometry } from "../format/segmented";
import { truncateLine } from "../shell-text";
import { palette } from "../shell-theme";

/** Width the hint claims when one is present, so tabs are not measured against it. */
const HINT_RESERVE = 20;

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
  const tabBudget =
    maxWidth === undefined ? Number.POSITIVE_INFINITY : maxWidth - (hint ? HINT_RESERVE : 0);
  const { segments, hiddenBefore, hiddenAfter } = windowedSegmentGeometry(
    labels,
    activeIndex,
    tabBudget,
  );
  return (
    <Box
      flexDirection="row"
      marginTop={dense ? 0 : 1}
      marginBottom={dense ? 0 : 1}
      alignItems="center"
      width={maxWidth}
      overflow="hidden"
    >
      {hiddenBefore > 0 ? (
        <Box flexShrink={0}>
          <Text color={palette.dim}>{"‹ "}</Text>
        </Box>
      ) : null}
      {segments.map((seg, i) => (
        <React.Fragment key={seg.label}>
          {i > 0 ? <Text color={palette.dim}>{"  "}</Text> : null}
          {/* Never shrink: a squeezed tab strip renders section names as
              unreadable stumps rather than dropping the ones that do not fit. */}
          <Box flexShrink={0}>
            <Text
              bold={seg.active}
              color={seg.active ? palette.text : palette.textDim}
              backgroundColor={seg.active ? palette.accentFill : undefined}
            >
              {seg.text}
            </Text>
          </Box>
        </React.Fragment>
      ))}
      {hiddenAfter > 0 ? (
        <Box flexShrink={0}>
          <Text color={palette.dim}>{" ›"}</Text>
        </Box>
      ) : null}
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
