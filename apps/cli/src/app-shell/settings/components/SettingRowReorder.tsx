import { Box, Text } from "ink";
import React from "react";

import { plainModeEnabled, selectionPrefix } from "../../plain-mode";
import { palette } from "../../shell-theme";
import type { BuiltSettingsRow } from "../types";
import { fitSettingsRowText } from "./row-layout";

export const SettingRowReorder = React.memo(function SettingRowReorder({
  row,
  selected,
  rowWidth,
}: {
  readonly row: BuiltSettingsRow;
  readonly selected: boolean;
  readonly rowWidth: number;
}) {
  const plain = plainModeEnabled();
  const prefix = selectionPrefix(selected, plain);
  const fitted = fitSettingsRowText({ width: rowWidth, prefix, label: row.def.label, value: row.valueSummary, plain });
  return (
    <Box width={rowWidth} backgroundColor={selected && !plain ? palette.accentFill : undefined}>
      <Text color={selected ? palette.accent : palette.dim}>
        {prefix}
      </Text>
      <Text bold={selected} color={selected ? palette.text : palette.textDim}>
        {fitted.label}
      </Text>
      {fitted.value ? <Text color={palette.dim}>{fitted.separator}{fitted.value}</Text> : null}
    </Box>
  );
});
