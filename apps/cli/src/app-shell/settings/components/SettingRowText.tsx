import { Box, Text } from "ink";
import React from "react";

import { plainModeEnabled, selectionPrefix } from "../../plain-mode";
import { palette } from "../../shell-theme";
import type { BuiltSettingsRow } from "../types";

export const SettingRowText = React.memo(function SettingRowText({
  row,
  selected,
  rowWidth,
}: {
  readonly row: BuiltSettingsRow;
  readonly selected: boolean;
  readonly rowWidth: number;
}) {
  const plain = plainModeEnabled();
  const summary = row.disabledReason ? "env locked" : row.valueSummary;

  return (
    <Box width={rowWidth} backgroundColor={selected && !plain ? palette.accentFill : undefined}>
      <Text color={selected ? palette.accent : palette.dim}>
        {selectionPrefix(selected, plain)}
      </Text>
      {plain ? null : <Text color={palette.muted}>{"› ".padEnd(3)}</Text>}
      <Text bold={selected} color={selected ? palette.text : palette.textDim}>
        {row.def.label}
      </Text>
      <Text color={palette.dim}>{plain ? `: ${summary}` : ` ·  ${summary}`}</Text>
      {row.envBadge ? <Text color={palette.ok}> {"(env)"}</Text> : null}
    </Box>
  );
});
