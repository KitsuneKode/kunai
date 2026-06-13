import { Box, Text } from "ink";
import React from "react";

import { segmentGeometry } from "../format/segmented";
import { palette } from "../shell-theme";

/** Destination "you are here" strip: active = filled cream pill. */
export const TabStrip = React.memo(function TabStrip({
  labels,
  activeIndex,
}: {
  labels: readonly string[];
  activeIndex: number;
}) {
  const segments = segmentGeometry(labels, activeIndex);
  return (
    <Box>
      {segments.map((seg, i) => (
        <React.Fragment key={seg.label}>
          {i > 0 ? <Text color={palette.dim}>{"  "}</Text> : null}
          <Text
            bold={seg.active}
            color={seg.active ? palette.bg : palette.muted}
            backgroundColor={seg.active ? palette.text : undefined}
          >
            {seg.text}
          </Text>
        </React.Fragment>
      ))}
    </Box>
  );
});
