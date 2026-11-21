import { Text } from "ink";
import React from "react";

import { decorationGlyphs } from "../decoration-policy";
import { palette } from "../shell-theme";

const BOOLEAN_SWITCH_WIDTH = 8;

export function BooleanSwitch({
  on,
  width = BOOLEAN_SWITCH_WIDTH,
}: {
  on: boolean;
  width?: number;
}) {
  const glyphs = decorationGlyphs();
  const label = on ? `${glyphs.radioOn} on` : `${glyphs.radioOff} off`;
  return (
    <Text color={on ? palette.ok : palette.muted} dimColor={!on}>
      {label.padEnd(width)}
    </Text>
  );
}
