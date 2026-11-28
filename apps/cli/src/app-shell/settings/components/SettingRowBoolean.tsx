import { Box, Text } from "ink";
import React from "react";

import { plainModeEnabled, plainSwitchText, selectionPrefix } from "../../plain-mode";
import { palette } from "../../shell-theme";
import type { BuiltSettingsRow } from "../types";
import { fitSettingsRowText } from "./row-layout";

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
  const prefix = selectionPrefix(selected, plain);
  const fitted = fitSettingsRowText({
    width: rowWidth,
    prefix,
    label: row.def.label,
    value: plainSwitchText(isOn, plain),
    plain,
  });

  return (
    <Box width={rowWidth} backgroundColor={selected && !plain ? palette.accentFill : undefined}>
      <Text color={selected ? palette.accent : palette.dim}>
        {prefix}
      </Text>
      <Text bold={selected} color={selected ? palette.text : palette.textDim}>
        {fitted.label}
      </Text>
      <Text color={palette.dim}>{fitted.separator}{fitted.value}</Text>
      {row.envBadge ? <Text color={palette.dim}> {"(env)"}</Text> : null}
    </Box>
  );
});
