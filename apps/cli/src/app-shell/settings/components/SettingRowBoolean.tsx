import { Box, Text } from "ink";
import React from "react";

import { BooleanSwitch } from "../../primitives/Switch";
import { palette } from "../../shell-theme";
import type { BuiltSettingsRow } from "../types";

export const SettingRowBoolean = React.memo(function SettingRowBoolean({
  row,
  selected,
  rowWidth,
}: {
  readonly row: BuiltSettingsRow;
  readonly selected: boolean;
  readonly rowWidth: number;
}) {
  const isOn = row.valueSummary === "on";

  return (
    <Box width={rowWidth} backgroundColor={selected ? palette.accentFill : undefined}>
      <Text color={selected ? palette.accent : palette.dim}>{selected ? "▌ " : "  "}</Text>
      <BooleanSwitch on={isOn} />
      <Text bold={selected} color={selected ? palette.text : palette.textDim}>
        {row.def.label}
      </Text>
      {row.envBadge ? <Text color={palette.dim}> {"(env)"}</Text> : null}
    </Box>
  );
});
