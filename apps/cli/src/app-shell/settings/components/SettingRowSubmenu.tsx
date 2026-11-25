import { Box, Text } from "ink";
import React from "react";

import { plainModeEnabled, selectionPrefix } from "../../plain-mode";
import { palette } from "../../shell-theme";
import type { BuiltSettingsRow } from "../types";

export const SettingRowSubmenu = React.memo(function SettingRowSubmenu({
  row,
  selected,
  rowWidth,
}: {
  readonly row: BuiltSettingsRow;
  readonly selected: boolean;
  readonly rowWidth: number;
}) {
  const plain = plainModeEnabled();
  return (
    <Box width={rowWidth} backgroundColor={selected && !plain ? palette.accentFill : undefined}>
      <Text color={selected ? palette.accent : palette.dim}>
        {selectionPrefix(selected, plain)}
      </Text>
      {plain ? null : <Text color={palette.muted}>▸ </Text>}
      <Text bold={selected} color={selected ? palette.text : palette.textDim}>
        {row.def.label}
      </Text>
      {row.valueSummary ? (
        <Text color={palette.dim}>
          {plain ? `: ${row.valueSummary}` : ` ·  ${row.valueSummary}`}
        </Text>
      ) : null}
    </Box>
  );
});
