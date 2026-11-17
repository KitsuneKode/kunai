import React from "react";

import { palette } from "../shell-theme";
import { Text } from "../ShellInk";

const BOOLEAN_SWITCH_WIDTH = 8;

export function BooleanSwitch({
  on,
  width = BOOLEAN_SWITCH_WIDTH,
}: {
  on: boolean;
  width?: number;
}) {
  const label = on ? "● on" : "○ off";
  return (
    <Text color={on ? palette.ok : palette.muted} dimColor={!on}>
      {label.padEnd(width)}
    </Text>
  );
}
