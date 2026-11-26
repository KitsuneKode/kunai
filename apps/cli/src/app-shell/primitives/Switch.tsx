import { Text } from "ink";
import React from "react";

import { plainModeEnabled, plainSwitchText } from "../plain-mode";
import { palette } from "../shell-theme";

const BOOLEAN_SWITCH_WIDTH = 8;

export function BooleanSwitch({
  on,
  width = BOOLEAN_SWITCH_WIDTH,
}: {
  on: boolean;
  width?: number;
}) {
  const plain = plainModeEnabled();
  const label = plainSwitchText(on, plain);
  return (
    <Text color={on ? palette.ok : palette.muted} dimColor={!on && !plain}>
      {plain ? `${label} ` : label.padEnd(width)}
    </Text>
  );
}
