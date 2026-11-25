import { Box, Text } from "ink";
import React from "react";

import { plainModeEnabled, selectionPrefix } from "../../plain-mode";
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
  const plain = plainModeEnabled();
  const isOn = row.valueSummary === "on";

  return (
    <Box width={rowWidth} backgroundColor={selected && !plain ? palette.accentFill : undefined}>
      <Text color={selected ? palette.accent : palette.dim}>
        {selectionPrefix(selected, plain)}
      </Text>
      <BooleanSwitch on={isOn} />
      <Text bold={selected} color={selected ? palette.text : palette.textDim}>
        {row.def.label}
      </Text>
      {row.envBadge ? <Text color={palette.dim}> {"(env)"}</Text> : null}
    </Box>
  );
});
