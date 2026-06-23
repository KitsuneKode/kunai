import { Box, Text } from "ink";
import React from "react";

import { SegmentedControl } from "../../primitives/SegmentedControl";
import { palette } from "../../shell-theme";
import type { BuiltSettingsRow } from "../types";

export const SettingRowEnum = React.memo(function SettingRowEnum({
  row,
  selected,
  rowWidth,
}: {
  readonly row: BuiltSettingsRow;
  readonly selected: boolean;
  readonly rowWidth: number;
}) {
  if (row.def.kind !== "enum" || row.def.presentation === "submenu") return null;
  const activeIndex = Math.max(
    0,
    row.def.options.findIndex((option) => option.value === row.valueSummary),
  );

  return (
    <Box
      width={rowWidth}
      backgroundColor={selected ? palette.surfaceActive : undefined}
      flexDirection="column"
    >
      <Box>
        <Text color={selected ? palette.accent : palette.dim}>{selected ? "▌ " : "  "}</Text>
        <Text bold={selected} color={selected ? palette.text : palette.textDim}>
          {row.def.label}
        </Text>
      </Box>
      <Box marginLeft={2}>
        <SegmentedControl
          labels={row.def.options.map((option) => option.label)}
          activeIndex={activeIndex}
        />
      </Box>
    </Box>
  );
});
