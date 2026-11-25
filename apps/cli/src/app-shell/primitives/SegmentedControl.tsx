import { Box, Text } from "ink";
import React from "react";

import { segmentGeometry } from "../format/segmented";
import { plainModeEnabled, plainTabLabel } from "../plain-mode";
import { palette } from "../shell-theme";

/** Filter/range segmented control: active segment gets an accent-fill pill. */
export const SegmentedControl = React.memo(function SegmentedControl({
  labels,
  activeIndex,
  activeBg = palette.accentFill,
  activeFg = palette.accent,
}: {
  labels: readonly string[];
  activeIndex: number;
  activeBg?: string;
  activeFg?: string;
}) {
  if (plainModeEnabled()) {
    return (
      <Box>
        <Text color={palette.text}>
          {labels
            .map((label, index) => plainTabLabel(label, index === activeIndex, true))
            .join(" | ")}
        </Text>
      </Box>
    );
  }
  const segments = segmentGeometry(labels, activeIndex);
  return (
    <Box>
      {segments.map((seg, i) => (
        <React.Fragment key={seg.label}>
          {i > 0 ? <Text color={palette.dim}> </Text> : null}
          <Text
            color={seg.active ? activeFg : palette.muted}
            backgroundColor={seg.active ? activeBg : undefined}
          >
            {seg.text}
          </Text>
        </React.Fragment>
      ))}
    </Box>
  );
});
