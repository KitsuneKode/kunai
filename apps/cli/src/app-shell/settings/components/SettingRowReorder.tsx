import { Box, Text } from "ink";
import React from "react";

import { decorationGlyphs, listSelectionPrefix } from "../../decoration-policy";
import { palette } from "../../shell-theme";
import type { BuiltSettingsRow } from "../types";

export const SettingRowReorder = React.memo(function SettingRowReorder({
  row,
  selected,
  rowWidth,
}: {
  readonly row: BuiltSettingsRow;
  readonly selected: boolean;
  readonly rowWidth: number;
}) {
  return (
    <Box width={rowWidth} backgroundColor={selected ? palette.accentFill : undefined}>
      <Text color={selected ? palette.accent : palette.dim}>{listSelectionPrefix(selected)}</Text>
      <Text color={palette.muted}>{`${decorationGlyphs().disclosure} `}</Text>
      <Text bold={selected} color={selected ? palette.text : palette.textDim}>
        {row.def.label}
      </Text>
      <Text color={palette.dim}> {`·  ${row.valueSummary}`}</Text>
    </Box>
  );
});
